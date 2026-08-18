/**
 * Esecuzione dello scraping da riga di comando.
 *
 *   npm run scrape:local                 # scraping + salvataggio, niente email
 *   npm run scrape:local -- --dry        # solo parsing, non tocca il database
 *   npm run scrape:local -- --digest     # scrive il digest in tmp/digest.html
 *   npm run scrape:local -- --send       # invia davvero l'email con Resend
 *   npm run scrape:local -- --score      # valuta la rilevanza (consuma API)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { inviaDigest, preparaDigest } from "../src/lib/digest";
import { formatData } from "../src/lib/format";
import { runScraper } from "../src/lib/pipeline";
import { prisma } from "../src/lib/prisma";
import { scrapers } from "../src/lib/scrapers";
import { valutaNuoviBandi } from "../src/lib/scoring";

const argomenti = new Set(process.argv.slice(2));
const dry = argomenti.has("--dry");
const conDigest = argomenti.has("--digest") || argomenti.has("--send");
const invia = argomenti.has("--send");
const conScoring = argomenti.has("--score");

async function main() {
  console.log(`Fonti registrate: ${scrapers.map((s) => s.slug).join(", ")}\n`);

  if (dry) {
    // Modalità diagnostica: mostra cosa vede il parser senza scrivere nulla.
    for (const scraper of scrapers) {
      console.log(`── ${scraper.nome}\n   ${scraper.entryUrl}`);
      const risultato = await scraper.run();
      console.log(`   ${risultato.items.length} voci su ${risultato.pagine} pagine`);
      for (const warning of risultato.warnings) console.log(`   ! ${warning}`);
      for (const item of risultato.items) {
        console.log(
          `\n   • ${item.titolo}\n     ente: ${item.ente ?? "—"}\n     scadenza: ${formatData(item.dataScadenza)} | pubbl.: ${formatData(item.dataPubblicazione)}\n     importo: ${item.importo ?? "—"}\n     beneficiari: ${item.beneficiari ?? "—"}\n     categorie: ${item.categorie?.join(", ") || "—"}\n     ${item.url}`,
        );
      }
    }
    return;
  }

  const esiti = [];
  for (const scraper of scrapers) {
    console.log(`── ${scraper.nome}`);
    const esito = await runScraper(scraper);
    esiti.push(esito);
    if (!esito.ok) {
      console.log(`   ERRORE: ${esito.errore}`);
      continue;
    }
    console.log(
      `   ${esito.totaliTrovati} voci trovate → ${esito.nuovi.length} nuove, ${esito.aggiornati.length} aggiornate`,
    );
    for (const warning of esito.warnings) console.log(`   ! ${warning}`);
    for (const aggiornato of esito.aggiornati) {
      for (const modifica of aggiornato.modifiche) {
        console.log(
          `   ~ ${aggiornato.bando.titolo.slice(0, 60)}… ${modifica.campo}: ${modifica.prima ?? "—"} → ${modifica.dopo ?? "—"}`,
        );
      }
    }
  }

  const nuovi = esiti.flatMap((e) => e.nuovi);
  const aggiornati = esiti.flatMap((e) => e.aggiornati);

  if (conScoring) {
    console.log(`\nScoring di ${nuovi.length} nuovi bandi…`);
    const scoring = await valutaNuoviBandi(nuovi);
    console.log(`   valutati: ${scoring.valutati}, falliti: ${scoring.falliti}`);
    for (const n of nuovi) {
      console.log(
        `   [${n.bando.rilevanza ?? "?"}/5] ${n.bando.titolo.slice(0, 70)}\n        ${n.bando.rilevanzaMotivo ?? "—"}`,
      );
    }
  }

  if (conDigest) {
    const digest = await preparaDigest({ nuovi, aggiornati, fonti: esiti });
    mkdirSync("tmp", { recursive: true });
    writeFileSync("tmp/digest.html", digest.html);
    writeFileSync("tmp/digest.txt", digest.text);
    console.log(`\nDigest: "${digest.subject}"`);
    console.log(`   salvato in tmp/digest.html e tmp/digest.txt`);
    if (invia) {
      const esitoInvio = await inviaDigest(digest);
      console.log(
        esitoInvio.inviato
          ? `   inviato (id ${esitoInvio.id})`
          : `   NON inviato: ${esitoInvio.motivo}`,
      );
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
