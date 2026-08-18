import * as cheerio from "cheerio";

/**
 * Paginazione dei portali ASP.NET.
 *
 * Esistono due meccanismi, e lo stesso sito può usarli in punti diversi:
 *  1. querystring — `?Tipo=1&page=2`, banale;
 *  2. postback — il link è `javascript:__doPostBack('ctl00$...','2')` e la
 *     pagina successiva si ottiene facendo POST degli hidden field
 *     (`__VIEWSTATE`, `__EVENTVALIDATION`, ...) insieme a `__EVENTTARGET`.
 *
 * Qui vengono riconosciuti entrambi; lo scraper prova il primo che trova.
 */

/** Nomi di parametro usati per il numero di pagina. */
const PARAMETRI_PAGINA = [
  "page", "pagina", "pageindex", "pagenumber", "currentpage", "p", "pag",
];

/** Testi che, su un link di paginazione, indicano "pagina successiva". */
const TESTO_SUCCESSIVA = /^(\s*(»|>|>>|→|successiv[ao]|avanti|next|prossima)\s*)$/i;

export interface PostbackTarget {
  eventTarget: string;
  eventArgument: string;
}

export type NextPage =
  | { kind: "url"; url: string }
  | { kind: "postback"; target: PostbackTarget }
  | { kind: "none" };

/** Legge tutti gli `<input type="hidden">`: sono lo stato del form ASP.NET. */
export function extractHiddenFields(html: string): Record<string, string> {
  const $ = cheerio.load(html);
  const fields: Record<string, string> = {};
  $("input[type=hidden]").each((_, el) => {
    const name = $(el).attr("name");
    if (name) fields[name] = $(el).attr("value") ?? "";
  });
  return fields;
}

/** L'`action` del form, cioè dove va inviato il postback. */
export function extractFormAction(html: string, baseUrl: string): string {
  const $ = cheerio.load(html);
  const action = $("form").first().attr("action");
  if (!action) return baseUrl;
  return new URL(action, baseUrl).toString();
}

function numeroPagina(url: URL): number | null {
  for (const [key, value] of url.searchParams) {
    if (PARAMETRI_PAGINA.includes(key.toLowerCase())) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * Individua il link alla pagina successiva.
 *
 * `paginaCorrente` serve a distinguere "avanti" da "indietro" quando il pager
 * espone solo numeri: si prende il numero più basso fra quelli maggiori.
 */
export function findNextPage(
  html: string,
  currentUrl: string,
  paginaCorrente: number,
): NextPage {
  const $ = cheerio.load(html);

  let migliorUrl: { url: string; pagina: number } | null = null;
  let migliorPostback: { target: PostbackTarget; pagina: number } | null = null;

  $("a").each((_, el) => {
    const link = $(el);
    const href = link.attr("href") ?? "";
    const testo = link.text().trim();

    // Caso 2: postback.
    const postback = href.match(/__doPostBack\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/);
    if (postback) {
      const target: PostbackTarget = {
        eventTarget: postback[1],
        eventArgument: postback[2],
      };
      // L'argomento è spesso `Page$3`, oppure il testo del link è il numero.
      const daArgomento = target.eventArgument.match(/(\d+)\s*$/);
      const daTesto = /^\d+$/.test(testo) ? Number(testo) : null;
      const pagina = daArgomento ? Number(daArgomento[1]) : daTesto;

      if (TESTO_SUCCESSIVA.test(testo)) {
        // "Successiva" è il segnale più affidabile: vince sui numeri.
        migliorPostback = { target, pagina: paginaCorrente + 1 };
        return;
      }
      if (pagina !== null && pagina > paginaCorrente) {
        if (!migliorPostback || pagina < migliorPostback.pagina) {
          migliorPostback = { target, pagina };
        }
      }
      return;
    }

    // Caso 1: querystring.
    if (!href || href.startsWith("javascript:") || href.startsWith("#")) return;
    let url: URL;
    try {
      url = new URL(href, currentUrl);
    } catch {
      return;
    }
    const pagina = numeroPagina(url);
    if (pagina === null) return;

    if (TESTO_SUCCESSIVA.test(testo) && pagina > paginaCorrente) {
      migliorUrl = { url: url.toString(), pagina };
      return;
    }
    if (pagina > paginaCorrente) {
      if (!migliorUrl || pagina < migliorUrl.pagina) {
        migliorUrl = { url: url.toString(), pagina };
      }
    }
  });

  if (migliorUrl) return { kind: "url", url: (migliorUrl as { url: string }).url };
  if (migliorPostback) {
    return { kind: "postback", target: (migliorPostback as { target: PostbackTarget }).target };
  }
  return { kind: "none" };
}

/** Costruisce il body del POST di paginazione a partire dallo stato del form. */
export function buildPostbackBody(
  hiddenFields: Record<string, string>,
  target: PostbackTarget,
): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(hiddenFields)) {
    body.set(key, value);
  }
  body.set("__EVENTTARGET", target.eventTarget);
  body.set("__EVENTARGUMENT", target.eventArgument);
  return body;
}
