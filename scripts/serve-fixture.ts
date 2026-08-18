/**
 * Server locale che imita bandi.regione.veneto.it usando i file in fixtures/.
 *
 * Serve a far girare lo scraper *davvero* — fetch, robots.txt, paginazione via
 * postback ASP.NET — senza dipendere dalla rete e senza tempestare di
 * richieste il portale della Regione mentre si sviluppa il parser.
 *
 *   npm run fixture:serve
 *   BANDI_VENETO_BASE_URL=http://127.0.0.1:8787 npm run scrape:local
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.FIXTURE_PORT ?? 8787);
const DIR = join(process.cwd(), "fixtures");

function pagina(n: number): string {
  return readFileSync(join(DIR, `elenco-tipo1-pag${n}.html`), "utf8");
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (url.pathname === "/robots.txt") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(readFileSync(join(DIR, "robots.txt"), "utf8"));
    return;
  }

  if (!/^\/public\/elenco$/i.test(url.pathname)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  if (req.method === "POST") {
    // Postback: la pagina richiesta arriva in __EVENTARGUMENT come "Page$N".
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const params = new URLSearchParams(body);
      const argomento = params.get("__EVENTARGUMENT") ?? "";
      const match = argomento.match(/(\d+)\s*$/);
      const n = match ? Number(match[1]) : 1;

      // Come il portale vero: senza __VIEWSTATE il postback non è valido.
      if (!params.get("__VIEWSTATE")) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Invalid postback: __VIEWSTATE mancante");
        return;
      }
      if (n < 1 || n > 3) {
        // Oltre l'ultima pagina il portale rimanda l'ultima disponibile.
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(pagina(3));
        return;
      }
      console.log(`[fixture] POST pagina ${n}`);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(pagina(n));
    });
    return;
  }

  console.log(`[fixture] GET ${url.pathname}${url.search}`);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(pagina(1));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Fixture di bandi.regione.veneto.it su http://127.0.0.1:${PORT}`);
});
