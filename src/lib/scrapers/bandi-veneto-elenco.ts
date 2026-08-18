import { env } from "../env";
import { assertAllowedByRobots, politeFetch } from "../http";
import { parseElencoPage } from "./elenco-parser";
import {
  buildPostbackBody,
  extractFormAction,
  extractHiddenFields,
  findNextPage,
} from "./pagination";
import type { RawBando, ScrapeResult, Scraper } from "./types";

/**
 * Fonte: bandi.regione.veneto.it — elenchi pubblici.
 *
 * `Tipo` distingue Bandi e Finanziamenti (1), Avvisi (2), Concorsi e Stage (3):
 * le tre pagine condividono lo stesso impianto, quindi condividono lo scraper.
 * Attualmente è cablato solo Tipo=1, le altre due si attivano aggiungendo una
 * riga al registro in ./index.ts.
 */

export interface ElencoScraperConfig {
  slug: string;
  nome: string;
  tipoParam: 1 | 2 | 3;
  /** Etichetta salvata su Bando.tipo. */
  tipo: string;
}

export function createElencoScraper(config: ElencoScraperConfig): Scraper {
  const entryUrl = `${env.bandiVenetoBaseUrl}/Public/Elenco?Tipo=${config.tipoParam}`;

  return {
    slug: config.slug,
    nome: config.nome,
    entryUrl,

    async run(): Promise<ScrapeResult> {
      await assertAllowedByRobots(entryUrl);

      const items: RawBando[] = [];
      const warnings: string[] = [];
      /** URL già raccolti: serve anche a capire quando la paginazione gira a vuoto. */
      const urlVisti = new Set<string>();
      const paginePercorse = new Set<string>();

      let html = await politeFetch(entryUrl);
      let urlCorrente = entryUrl;
      let pagina = 1;

      while (pagina <= env.scraperMaxPages) {
        const parsed = parseElencoPage(html, {
          baseUrl: env.bandiVenetoBaseUrl,
          tipo: config.tipo,
        });
        warnings.push(...parsed.warnings.map((w) => `pagina ${pagina}: ${w}`));

        let nuoviInQuestaPagina = 0;
        for (const item of parsed.items) {
          if (urlVisti.has(item.url)) continue;
          urlVisti.add(item.url);
          items.push(item);
          nuoviInQuestaPagina++;
        }

        // Una pagina che non porta nulla di nuovo vuol dire che il pager ci ha
        // riportati dove eravamo: è la fine normale dell'elenco per i pager
        // che, oltre l'ultima pagina, continuano a restituire l'ultima. Non è
        // un'anomalia, quindi non sporca l'esito del run.
        if (pagina > 1 && nuoviInQuestaPagina === 0) break;

        const next = findNextPage(html, urlCorrente, pagina);
        if (next.kind === "none") break;

        if (next.kind === "url") {
          if (paginePercorse.has(next.url)) break;
          paginePercorse.add(next.url);
          urlCorrente = next.url;
          html = await politeFetch(next.url);
        } else {
          // Postback: rimanda tutto lo stato del form insieme all'evento.
          const chiave = `${next.target.eventTarget}|${next.target.eventArgument}`;
          if (paginePercorse.has(chiave)) break;
          paginePercorse.add(chiave);

          const action = extractFormAction(html, urlCorrente);
          const body = buildPostbackBody(extractHiddenFields(html), next.target);
          html = await politeFetch(action, {
            method: "POST",
            body,
            headers: { Referer: urlCorrente },
          });
          urlCorrente = action;
        }
        pagina++;
      }

      if (pagina > env.scraperMaxPages) {
        warnings.push(
          `Raggiunto il tetto di ${env.scraperMaxPages} pagine: potrebbero mancare voci più vecchie.`,
        );
      }

      return { items, pagine: pagina, warnings };
    },
  };
}

export const bandiFinanziamentiScraper = createElencoScraper({
  slug: "bandi-veneto-tipo1",
  nome: "Regione Veneto — Bandi e Finanziamenti",
  tipoParam: 1,
  tipo: "Bando e Finanziamento",
});
