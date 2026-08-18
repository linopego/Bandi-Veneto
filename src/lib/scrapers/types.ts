/**
 * Contratto comune a tutte le fonti.
 *
 * Ogni scraper vive in un modulo separato ed espone solo `run()`. Il pipeline
 * non sa nulla di come è fatta la pagina: se una fonte cambia markup o smette
 * di rispondere, il danno resta confinato al suo modulo.
 */

/** Una voce così come esce dal parser, prima di toccare il database. */
export interface RawBando {
  titolo: string;
  url: string;
  tipo: string;
  ente?: string | null;
  descrizione?: string | null;
  dataPubblicazione?: Date | null;
  dataScadenza?: Date | null;
  importo?: string | null;
  beneficiari?: string | null;
  categorie?: string[];
}

export interface ScrapeResult {
  items: RawBando[];
  /** Quante pagine sono state effettivamente percorse. */
  pagine: number;
  /**
   * Anomalie non fatali: pagina senza risultati, campo non trovato, paginazione
   * interrotta. Finiscono in ScrapeRun con esito PARZIALE.
   */
  warnings: string[];
}

export interface Scraper {
  /** Identificatore stabile, salvato su Bando.fonte e ScrapeRun.fonte. */
  slug: string;
  /** Nome leggibile, mostrato in dashboard. */
  nome: string;
  /** URL di partenza, utile per diagnosticare una fonte rotta. */
  entryUrl: string;
  run(): Promise<ScrapeResult>;
}
