import { env } from "./env";

/**
 * Client HTTP condiviso dagli scraper.
 *
 * Tre regole di educazione verso le fonti, tutte concentrate qui:
 *  - User-Agent onesto, che dichiara cosa siamo e come farci smettere;
 *  - una pausa fra richieste consecutive verso lo stesso host;
 *  - rispetto di robots.txt (scaricato una volta per host e tenuto in cache).
 */

export const USER_AGENT = (() => {
  const contact = env.scraperContact;
  const base =
    "BandiVenetoMonitor/1.0 (monitoraggio bandi regionali, non commerciale";
  return contact ? `${base}; ${contact})` : `${base})`;
})();

/** Timestamp dell'ultima richiesta per host, per spaziare le chiamate. */
const lastRequestAt = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle(host: string): Promise<void> {
  const delay = env.scraperDelayMs;
  if (delay <= 0) return;
  const last = lastRequestAt.get(host);
  if (last !== undefined) {
    const elapsed = Date.now() - last;
    if (elapsed < delay) await sleep(delay - elapsed);
  }
  lastRequestAt.set(host, Date.now());
}

export interface FetchOptions {
  method?: "GET" | "POST";
  body?: URLSearchParams;
  /** Tentativi totali in caso di errore di rete o 5xx. */
  retries?: number;
  headers?: Record<string, string>;
}

/**
 * GET/POST con throttling, User-Agent e ritentativi con backoff esponenziale.
 * I 4xx non vengono ritentati: sono errori nostri, non della rete.
 */
export async function politeFetch(
  url: string,
  options: FetchOptions = {},
): Promise<string> {
  const { method = "GET", body, retries = 3, headers = {} } = options;
  const host = new URL(url).host;

  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    await throttle(host);
    try {
      const response = await fetch(url, {
        method,
        body,
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "it-IT,it;q=0.9",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          ...headers,
        },
        redirect: "follow",
      });

      if (response.status >= 400 && response.status < 500) {
        throw new Error(`HTTP ${response.status} ${response.statusText} su ${url}`);
      }
      if (!response.ok) {
        // 5xx: vale la pena riprovare.
        lastError = new Error(
          `HTTP ${response.status} ${response.statusText} su ${url}`,
        );
        await sleep(2 ** attempt * 1000);
        continue;
      }
      return await response.text();
    } catch (error) {
      // Un 4xx è definitivo: inutile insistere.
      if (error instanceof Error && /HTTP 4\d\d/.test(error.message)) throw error;
      lastError = error;
      if (attempt < retries - 1) await sleep(2 ** attempt * 1000);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Richiesta fallita su ${url}: ${String(lastError)}`);
}

/** Regole robots.txt già scaricate, per host. */
const robotsCache = new Map<string, Promise<string[]>>();

/**
 * Legge i `Disallow` che si applicano a noi: prima il gruppo del nostro
 * User-Agent, altrimenti quello `*`. Parser volutamente minimale — copre
 * quello che i portali della PA usano davvero.
 */
async function loadDisallowRules(origin: string): Promise<string[]> {
  const response = await fetch(`${origin}/robots.txt`, {
    headers: { "User-Agent": USER_AGENT },
  });
  // Nessun robots.txt (404) significa nessuna restrizione dichiarata.
  if (!response.ok) return [];
  const text = await response.text();

  const groups = new Map<string, string[]>();
  let currentAgents: string[] = [];
  let expectingRules = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      // Una nuova riga User-Agent dopo delle regole apre un gruppo nuovo.
      if (expectingRules) {
        currentAgents = [];
        expectingRules = false;
      }
      currentAgents.push(value.toLowerCase());
      if (!groups.has(value.toLowerCase())) groups.set(value.toLowerCase(), []);
    } else if (field === "disallow") {
      expectingRules = true;
      for (const agent of currentAgents) {
        groups.get(agent)?.push(value);
      }
    }
  }

  const ourAgent = USER_AGENT.split("/")[0].toLowerCase();
  for (const [agent, rules] of groups) {
    if (agent !== "*" && ourAgent.includes(agent)) return rules;
  }
  return groups.get("*") ?? [];
}

/** True se robots.txt consente di scaricare quell'URL. */
export async function isAllowedByRobots(url: string): Promise<boolean> {
  const parsed = new URL(url);
  const origin = parsed.origin;

  if (!robotsCache.has(origin)) {
    robotsCache.set(
      origin,
      loadDisallowRules(origin).catch(() => {
        // robots.txt irraggiungibile: non è un motivo per bloccare lo scraping,
        // ma nemmeno per ignorarlo silenziosamente.
        console.warn(`[robots] ${origin}/robots.txt non leggibile, procedo`);
        return [] as string[];
      }),
    );
  }

  const disallow = await robotsCache.get(origin)!;
  const path = parsed.pathname + parsed.search;
  return !disallow.some((rule) => rule !== "" && path.startsWith(rule));
}

/** Da usare prima del primo fetch di ogni fonte. */
export async function assertAllowedByRobots(url: string): Promise<void> {
  if (!(await isAllowedByRobots(url))) {
    throw new Error(`robots.txt vieta l'accesso a ${url}: fonte saltata`);
  }
}
