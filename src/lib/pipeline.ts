import type { Bando } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { buildContentHash, buildSourceId, cleanText } from "./normalize";
import { scrapers } from "./scrapers";
import type { RawBando, Scraper } from "./scrapers/types";

/**
 * Dallo scraping al database.
 *
 * Regole:
 *  - la deduplica avviene su sourceId; un bando già visto non torna nel digest;
 *  - di un bando già noto si aggiornano solo i campi effettivamente cambiati,
 *    e ogni cambiamento lascia una riga in BandoModifica;
 *  - ogni fonte gira dentro il proprio try/catch e lascia una riga in
 *    ScrapeRun, così una fonte rotta non ferma le altre.
 */

export interface ModificaRilevata {
  campo: string;
  prima: string | null;
  dopo: string | null;
}

export interface EsitoBando {
  bando: Bando;
  stato: "nuovo" | "aggiornato" | "invariato";
  modifiche: ModificaRilevata[];
  /** True se fra i campi cambiati c'è la scadenza: è ciò che il digest evidenzia. */
  scadenzaCambiata: boolean;
}

export interface EsitoFonte {
  fonte: string;
  nome: string;
  ok: boolean;
  errore?: string;
  warnings: string[];
  nuovi: EsitoBando[];
  aggiornati: EsitoBando[];
  totaliTrovati: number;
}

/** Rappresentazione testuale di un valore, per lo storico modifiche. */
function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.join(", ");
  const text = cleanText(String(value));
  return text.length > 0 ? text : null;
}

/** Campi confrontati fra la versione salvata e quella appena raccolta. */
const CAMPI_CONFRONTATI = [
  "titolo", "tipo", "ente", "descrizione", "url",
  "dataPubblicazione", "dataScadenza", "importo", "beneficiari", "categorie",
] as const;

function diff(esistente: Bando, raw: RawBando): ModificaRilevata[] {
  const nuovo: Record<string, unknown> = {
    titolo: raw.titolo,
    tipo: raw.tipo,
    ente: raw.ente ?? null,
    descrizione: raw.descrizione ?? null,
    url: raw.url,
    dataPubblicazione: raw.dataPubblicazione ?? null,
    dataScadenza: raw.dataScadenza ?? null,
    importo: raw.importo ?? null,
    beneficiari: raw.beneficiari ?? null,
    categorie: raw.categorie ?? [],
  };

  const modifiche: ModificaRilevata[] = [];
  for (const campo of CAMPI_CONFRONTATI) {
    const prima = toText((esistente as unknown as Record<string, unknown>)[campo]);
    const dopo = toText(nuovo[campo]);
    // Un campo che sparisce dalla fonte non è una modifica: più spesso è
    // l'elenco che mostra meno dettagli del solito. Non si cancella nulla.
    if (dopo === null) continue;
    if (prima !== dopo) modifiche.push({ campo, prima, dopo });
  }
  return modifiche;
}

async function salvaVoce(fonte: string, raw: RawBando): Promise<EsitoBando> {
  const sourceId = buildSourceId(fonte, raw.url, raw.titolo);
  const contentHash = buildContentHash(raw);
  const esistente = await prisma.bando.findUnique({ where: { sourceId } });

  if (!esistente) {
    const bando = await prisma.bando.create({
      data: {
        sourceId,
        fonte,
        tipo: raw.tipo,
        titolo: raw.titolo,
        ente: raw.ente ?? null,
        descrizione: raw.descrizione ?? null,
        url: raw.url,
        dataPubblicazione: raw.dataPubblicazione ?? null,
        dataScadenza: raw.dataScadenza ?? null,
        importo: raw.importo ?? null,
        beneficiari: raw.beneficiari ?? null,
        categorie: raw.categorie ?? [],
        contentHash,
      },
    });
    return { bando, stato: "nuovo", modifiche: [], scadenzaCambiata: false };
  }

  // Il contentHash è il filtro veloce: se coincide non c'è nulla da fare.
  if (esistente.contentHash === contentHash) {
    return { bando: esistente, stato: "invariato", modifiche: [], scadenzaCambiata: false };
  }

  const modifiche = diff(esistente, raw);
  if (modifiche.length === 0) {
    // Hash diverso ma nessun campo confrontato è cambiato: allineo l'hash e basta.
    const bando = await prisma.bando.update({
      where: { id: esistente.id },
      data: { contentHash },
    });
    return { bando, stato: "invariato", modifiche: [], scadenzaCambiata: false };
  }

  const datiAggiornati: Record<string, unknown> = { contentHash };
  for (const modifica of modifiche) {
    switch (modifica.campo) {
      case "dataPubblicazione":
        datiAggiornati.dataPubblicazione = raw.dataPubblicazione;
        break;
      case "dataScadenza":
        datiAggiornati.dataScadenza = raw.dataScadenza;
        break;
      case "categorie":
        datiAggiornati.categorie = raw.categorie ?? [];
        break;
      default:
        datiAggiornati[modifica.campo] =
          (raw as unknown as Record<string, unknown>)[modifica.campo] ?? null;
    }
  }

  const bando = await prisma.bando.update({
    where: { id: esistente.id },
    data: {
      ...datiAggiornati,
      modifiche: {
        create: modifiche.map((m) => ({
          campo: m.campo,
          valorePrima: m.prima,
          valoreDopo: m.dopo,
        })),
      },
    },
  });

  return {
    bando,
    stato: "aggiornato",
    modifiche,
    scadenzaCambiata: modifiche.some((m) => m.campo === "dataScadenza"),
  };
}

/** Esegue una singola fonte e registra l'esito in ScrapeRun. */
export async function runScraper(scraper: Scraper): Promise<EsitoFonte> {
  const inizio = Date.now();
  const esito: EsitoFonte = {
    fonte: scraper.slug,
    nome: scraper.nome,
    ok: true,
    warnings: [],
    nuovi: [],
    aggiornati: [],
    totaliTrovati: 0,
  };
  let pagine = 0;

  try {
    const risultato = await scraper.run();
    pagine = risultato.pagine;
    esito.warnings = risultato.warnings;
    esito.totaliTrovati = risultato.items.length;

    for (const item of risultato.items) {
      const salvata = await salvaVoce(scraper.slug, item);
      if (salvata.stato === "nuovo") esito.nuovi.push(salvata);
      else if (salvata.stato === "aggiornato") esito.aggiornati.push(salvata);
    }

    // Zero voci con la fonte raggiungibile è il sintomo classico di un parser
    // rotto: va marcato PARZIALE perché salti all'occhio in /runs.
    const parserSospetto = esito.totaliTrovati === 0;
    if (parserSospetto) {
      esito.warnings.push("Nessuna voce estratta: parser probabilmente da aggiornare.");
    }

    await prisma.scrapeRun.create({
      data: {
        fonte: scraper.slug,
        esito: esito.warnings.length > 0 || parserSospetto ? "PARZIALE" : "OK",
        totaliTrovati: esito.totaliTrovati,
        nuoviTrovati: esito.nuovi.length,
        aggiornati: esito.aggiornati.length,
        paginePercorse: pagine,
        durataMs: Date.now() - inizio,
        errore: esito.warnings.length > 0 ? esito.warnings.join(" | ").slice(0, 2000) : null,
      },
    });
  } catch (error) {
    esito.ok = false;
    esito.errore = error instanceof Error ? error.message : String(error);
    await prisma.scrapeRun.create({
      data: {
        fonte: scraper.slug,
        esito: "ERRORE",
        totaliTrovati: esito.totaliTrovati,
        nuoviTrovati: esito.nuovi.length,
        aggiornati: esito.aggiornati.length,
        paginePercorse: pagine,
        durataMs: Date.now() - inizio,
        errore: esito.errore.slice(0, 2000),
      },
    });
  }

  return esito;
}

/** Esegue tutte le fonti registrate, una dopo l'altra e in isolamento. */
export async function runAllScrapers(): Promise<EsitoFonte[]> {
  const esiti: EsitoFonte[] = [];
  for (const scraper of scrapers) {
    esiti.push(await runScraper(scraper));
  }
  return esiti;
}
