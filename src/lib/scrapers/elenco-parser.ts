import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import {
  cleanOrNull,
  cleanText,
  normalizeImporto,
  parseItalianDate,
} from "../normalize";
import type { RawBando } from "./types";

/**
 * Parser dell'elenco di bandi.regione.veneto.it.
 *
 * Il portale è ASP.NET e i nomi delle classi CSS sono generati: agganciarsi a
 * `.card-bando` o a un `id` tipo `ctl00_ContentPlaceHolder1_...` significa
 * rompersi al primo restyle. Il parser parte invece dall'unica cosa stabile e
 * osservabile dall'esterno, cioè il link al dettaglio
 * (`/Public/Dettaglio?idAtto=NNNN`), e da lì risale al blocco che lo contiene.
 *
 * I campi si leggono per etichetta ("Scadenza:", "Ente:") sul testo del blocco,
 * non per posizione: regge tanto una <table> quanto una lista di <div>.
 */

/** Riconosce i link al dettaglio di un atto. */
const DETTAGLIO_HREF = /dettaglio/i;

/**
 * Etichette accettate per ogni campo, in ordine di preferenza.
 *
 * Volutamente non contengono parole che nella fonte compaiono come *valore*
 * ("Direzione", "Area"): userebbero il valore stesso come etichetta e
 * restituirebbero un campo troncato.
 */
const ETICHETTE = {
  scadenza: [
    "scadenza dei termini", "termine di presentazione", "termine presentazione",
    "data di scadenza", "data scadenza", "scadenza", "scade il",
  ],
  pubblicazione: [
    "data di pubblicazione", "data pubblicazione", "pubblicato il",
    "pubblicazione", "data bur", "data di adozione",
  ],
  ente: [
    "struttura regionale", "unità organizzativa", "ente erogatore",
    "a cura di", "ente",
  ],
  importo: [
    "dotazione finanziaria", "risorse disponibili", "importo complessivo",
    "stanziamento", "importo", "contributo", "dotazione",
  ],
  beneficiari: [
    "soggetti beneficiari", "destinatari", "beneficiari", "chi può partecipare",
  ],
  categorie: ["categorie", "categoria", "settore", "argomento", "tema", "materia"],
} as const;

/** Tutte le etichette note, per sapere dove finisce il valore di quella corrente. */
const TUTTE_LE_ETICHETTE = Object.values(ETICHETTE).flat();

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Estrae il valore che segue un'etichetta, fermandosi alla prima etichetta
 * successiva: `"Ente: Direzione Turismo Scadenza: 31/12/2026"` produce
 * `"Direzione Turismo"` e non si mangia la scadenza.
 *
 * Due passaggi, in ordine di affidabilità:
 *  1. l'etichetta deve essere seguita da `:` o `-`. È il caso normale, e
 *     soprattutto evita i falsi positivi dentro il titolo: in "istruttore
 *     amministrativo categoria C" la parola "categoria" non è un'etichetta.
 *  2. solo se il primo passaggio non trova nulla, si accetta anche senza
 *     separatore, per i markup a `<dt>/<dd>` dove i due punti non ci sono.
 *
 * La cattura ammette il vuoto: un campo presente ma senza valore
 * ("Importo:" seguito subito da "Beneficiari:") deve dare null, non il
 * contenuto del campo successivo.
 */
function estraiPerEtichetta(
  testo: string,
  etichette: readonly string[],
): string | null {
  // Il valore finisce dove comincia l'etichetta successiva. Nel delimitatore
  // il separatore è sempre richiesto, in entrambi i passaggi.
  const stop = TUTTE_LE_ETICHETTE.map(escapeRegex).join("|");
  const fine = `(?=\\s*(?:${stop})\\s*[:\\-–]|$)`;

  for (const separatoreRichiesto of [true, false]) {
    const separatore = separatoreRichiesto ? `\\s*[:\\-–]\\s*` : `\\s*[:\\-–]?\\s*`;
    for (const etichetta of etichette) {
      const regex = new RegExp(
        `(?:^|[^\\p{L}])${escapeRegex(etichetta)}${separatore}(.*?)${fine}`,
        "iu",
      );
      const match = testo.match(regex);
      const valore = cleanText(match?.[1]);
      // Un valore lunghissimo di solito vuol dire che l'etichetta ha agganciato
      // mezzo blocco: meglio scartarlo che salvare spazzatura.
      if (valore && valore.length <= 400) return valore;
    }
  }
  return null;
}

/**
 * Dato il link al dettaglio, risale al blocco che rappresenta *una sola* voce.
 * Si ferma un attimo prima dell'antenato che ne contiene due: quello è
 * l'elenco, non la riga.
 */
function trovaBloccoVoce(
  $: cheerio.CheerioAPI,
  link: cheerio.Cheerio<AnyNode>,
): cheerio.Cheerio<AnyNode> {
  let blocco = link;
  let corrente = link.parent();

  for (let livello = 0; livello < 8 && corrente.length > 0; livello++) {
    const linkDettaglio = corrente.find("a").filter((_, el) => {
      const href = $(el).attr("href");
      return Boolean(href && DETTAGLIO_HREF.test(href));
    });
    if (linkDettaglio.length > 1) break;
    const tag = (corrente.get(0) as { tagName?: string } | undefined)?.tagName;
    if (tag === "body" || tag === "html") break;
    blocco = corrente;
    corrente = corrente.parent();
  }
  return blocco;
}

/**
 * La descrizione è il testo del blocco meno il titolo e meno la parte di
 * metadati: in elenco è un occhiello breve, il testo lungo sta nella pagina di
 * dettaglio. Il taglio avviene alla prima etichetta riconosciuta, altrimenti
 * la descrizione conterrebbe "Ente: ... Scadenza: ..." già estratti a parte, e
 * ogni modifica a un metadato risulterebbe anche come modifica al testo.
 */
function estraiDescrizione(testoBlocco: string, titolo: string): string | null {
  let testo = testoBlocco.replace(titolo, " ");

  const stop = TUTTE_LE_ETICHETTE.map(escapeRegex).join("|");
  const primaEtichetta = testo.match(
    new RegExp(`(?:^|[^\\p{L}])(?:${stop})\\s*[:\\-–]`, "iu"),
  );
  if (primaEtichetta?.index !== undefined) {
    testo = testo.slice(0, primaEtichetta.index);
  }

  const descrizione = cleanText(testo).slice(0, 800);
  // Sotto una ventina di caratteri è un residuo di markup, non una descrizione.
  return descrizione.length >= 20 ? descrizione : null;
}

export interface ParseElencoOptions {
  /** Base per risolvere gli href relativi. */
  baseUrl: string;
  /** Etichetta di tipo da assegnare alle voci di questa pagina. */
  tipo: string;
}

export interface ParseElencoResult {
  items: RawBando[];
  warnings: string[];
}

export function parseElencoPage(
  html: string,
  { baseUrl, tipo }: ParseElencoOptions,
): ParseElencoResult {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const items: RawBando[] = [];
  const visti = new Set<string>();

  const linkDettaglio = $("a").filter((_, el) => {
    const href = $(el).attr("href");
    return Boolean(href && DETTAGLIO_HREF.test(href));
  });

  if (linkDettaglio.length === 0) {
    warnings.push(
      "Nessun link al dettaglio trovato nella pagina: il markup della fonte potrebbe essere cambiato.",
    );
    return { items, warnings };
  }

  let euristicaDate = 0;

  linkDettaglio.each((_, el) => {
    const link = $(el);
    const href = link.attr("href");
    if (!href) return;

    const url = new URL(href, baseUrl).toString();
    if (visti.has(url)) return;
    visti.add(url);

    const blocco = trovaBloccoVoce($, link);
    const testoBlocco = cleanText(blocco.text());

    // Il testo del link è il titolo naturale; se il link è solo un'icona
    // ("Dettaglio", ">>") si ripiega sull'intestazione del blocco.
    let titolo = cleanText(link.text());
    if (titolo.length < 8) {
      const heading = cleanText(blocco.find("h1,h2,h3,h4,h5,strong,b").first().text());
      if (heading.length > titolo.length) titolo = heading;
    }
    if (!titolo) {
      titolo = testoBlocco.slice(0, 160);
    }
    if (!titolo) return;

    let dataScadenza = parseItalianDate(
      estraiPerEtichetta(testoBlocco, ETICHETTE.scadenza),
    );
    let dataPubblicazione = parseItalianDate(
      estraiPerEtichetta(testoBlocco, ETICHETTE.pubblicazione),
    );

    // Nessuna etichetta riconosciuta ma due date nel blocco: la prima è quasi
    // sempre la pubblicazione e la seconda la scadenza. È un'ipotesi, quindi
    // viene segnalata come warning e finisce visibile in /runs.
    if (!dataScadenza && !dataPubblicazione) {
      const date = [...testoBlocco.matchAll(/\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}/g)]
        .map((m) => parseItalianDate(m[0]))
        .filter((d): d is Date => d !== null);
      if (date.length >= 2) {
        dataPubblicazione = date[0];
        dataScadenza = date[date.length - 1];
        euristicaDate++;
      } else if (date.length === 1) {
        dataScadenza = date[0];
        euristicaDate++;
      }
    }

    const categorieRaw = estraiPerEtichetta(testoBlocco, ETICHETTE.categorie);
    const categorie = categorieRaw
      ? categorieRaw.split(/[;,|]/).map((c) => cleanText(c)).filter(Boolean).slice(0, 8)
      : [];

    const descrizione = estraiDescrizione(testoBlocco, titolo);

    items.push({
      titolo,
      url,
      tipo,
      ente: cleanOrNull(estraiPerEtichetta(testoBlocco, ETICHETTE.ente)),
      descrizione,
      dataPubblicazione,
      dataScadenza,
      importo: normalizeImporto(estraiPerEtichetta(testoBlocco, ETICHETTE.importo)),
      beneficiari: cleanOrNull(estraiPerEtichetta(testoBlocco, ETICHETTE.beneficiari)),
      categorie,
    });
  });

  if (euristicaDate > 0) {
    warnings.push(
      `${euristicaDate} voci senza etichette di data riconosciute: date dedotte dalla posizione, da verificare.`,
    );
  }
  const senzaScadenza = items.filter((i) => !i.dataScadenza).length;
  if (items.length > 0 && senzaScadenza === items.length) {
    warnings.push(
      "Nessuna voce ha una data di scadenza: probabile cambio di etichette nella fonte.",
    );
  }

  return { items, warnings };
}
