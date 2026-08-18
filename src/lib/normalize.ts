import { createHash } from "node:crypto";

/** Comprime gli spazi e normalizza i non-breaking space tipici dell'HTML ASP.NET. */
export function cleanText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Come cleanText, ma restituisce null invece della stringa vuota. */
export function cleanOrNull(input: string | null | undefined): string | null {
  const cleaned = cleanText(input);
  return cleaned.length > 0 ? cleaned : null;
}

const MESI: Record<string, number> = {
  gennaio: 0, febbraio: 1, marzo: 2, aprile: 3, maggio: 4, giugno: 5,
  luglio: 6, agosto: 7, settembre: 8, ottobre: 9, novembre: 10, dicembre: 11,
};

/**
 * Interpreta le date nei formati che compaiono sui portali regionali:
 * `31/12/2026`, `31-12-2026`, `2026-12-31`, `31 dicembre 2026`.
 *
 * Le date sono costruite a mezzogiorno UTC: la scadenza è un giorno di
 * calendario, e mezzogiorno evita che il fuso la faccia scivolare al giorno
 * prima quando viene formattata in Europe/Rome.
 */
export function parseItalianDate(
  input: string | null | undefined,
): Date | null {
  const text = cleanText(input);
  if (!text) return null;

  const numeric = text.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    let year = Number(numeric[3]);
    if (year < 100) year += 2000;
    return buildDate(year, month, day);
  }

  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return buildDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  const testuale = text
    .toLowerCase()
    .match(/(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})/);
  if (testuale) {
    return buildDate(Number(testuale[3]), MESI[testuale[2]], Number(testuale[1]));
  }

  return null;
}

function buildDate(year: number, month: number, day: number): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
  // Scarta i 31 febbraio: JS li farebbe scivolare al mese dopo.
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return date;
}

/**
 * Normalizza un importo lasciandolo come testo: le fonti scrivono tanto
 * "€ 1.500.000,00" quanto "fino a 50.000 euro per impresa", e forzare un
 * numero perderebbe informazione utile a chi legge il digest.
 */
export function normalizeImporto(input: string | null | undefined): string | null {
  const text = cleanText(input);
  if (!text) return null;
  return text.replace(/\beuro\b/gi, "€").replace(/\s*€\s*/g, " € ").trim();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Identità di un bando fra un run e l'altro.
 *
 * Se l'URL espone un identificativo dell'atto (`idAtto=11267` sul portale
 * regionale) è quello la chiave: è l'unica cosa che la fonte garantisce
 * stabile. Solo in mancanza si ripiega su URL + titolo.
 *
 * Perché non sempre URL + titolo: i portali della PA correggono i titoli a
 * pubblicazione avvenuta (un refuso, una parola aggiunta). Con il titolo nella
 * chiave ogni correzione creerebbe un record nuovo e un falso "nuovo bando"
 * nel digest, invece di una modifica sul record esistente.
 */
export function buildSourceId(
  fonte: string,
  url: string,
  titolo: string,
): string {
  const idAtto = extractIdAtto(url);
  const chiave = idAtto ?? `${canonicalUrl(url)}::${cleanText(titolo).toLowerCase()}`;
  return sha256(`${fonte}::${chiave}`);
}

/** Estrae l'identificativo dell'atto dalla querystring, se presente. */
export function extractIdAtto(raw: string): string | null {
  try {
    const url = new URL(raw);
    for (const [key, value] of url.searchParams) {
      if (key.toLowerCase() === "idatto" && value.trim()) {
        return `idAtto=${value.trim()}`;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Toglie dall'URL i parametri che cambiano a seconda di come ci si è arrivati
 * (`fromPage`, tracciamenti), così lo stesso atto non genera due sourceId.
 */
export function canonicalUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const volatili = ["frompage", "fromsearch", "utm_source", "utm_medium", "utm_campaign"];
    for (const key of [...url.searchParams.keys()]) {
      if (volatili.includes(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return raw.trim();
  }
}

/** Campi il cui cambiamento significa "questo bando è stato aggiornato alla fonte". */
export function buildContentHash(values: {
  titolo: string;
  ente?: string | null;
  descrizione?: string | null;
  dataScadenza?: Date | null;
  dataPubblicazione?: Date | null;
  importo?: string | null;
  beneficiari?: string | null;
}): string {
  return sha256(
    [
      cleanText(values.titolo),
      cleanText(values.ente),
      cleanText(values.descrizione),
      values.dataScadenza?.toISOString() ?? "",
      values.dataPubblicazione?.toISOString() ?? "",
      cleanText(values.importo),
      cleanText(values.beneficiari),
    ].join("|"),
  );
}
