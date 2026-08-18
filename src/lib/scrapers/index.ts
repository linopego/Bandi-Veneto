import { bandiFinanziamentiScraper } from "./bandi-veneto-elenco";
import type { Scraper } from "./types";

/**
 * Registro delle fonti attive.
 *
 * Il pipeline itera su questo array e isola ogni fonte in un try/catch, quindi
 * aggiungere una fonte significa solo aggiungere una riga qui. Le prossime:
 * Tipo=2 (Avvisi), Tipo=3 (Concorsi e Stage), scadenzario, Veneto Innovazione
 * (WordPress) e i feed RSS del BUR.
 */
export const scrapers: Scraper[] = [bandiFinanziamentiScraper];

export function getScraper(slug: string): Scraper | undefined {
  return scrapers.find((s) => s.slug === slug);
}

export type { Scraper } from "./types";
