import { NextResponse } from "next/server";
import { inviaDigest, preparaDigest } from "@/lib/digest";
import { runAllScrapers } from "@/lib/pipeline";
import { valutaBandiSenzaPunteggio, valutaNuoviBandi } from "@/lib/scoring";

/**
 * Endpoint invocato dal cron di Vercel (vedi vercel.json, ogni giorno alle 7:00).
 *
 * Protetto da CRON_SECRET: Vercel lo manda come `Authorization: Bearer`.
 * Lo stesso segreto si può passare a mano per far partire un run fuori orario.
 */

export const dynamic = "force-dynamic";
// Lo scraping di più fonti con rate limiting non sta nei 10 secondi di default.
export const maxDuration = 300;

function autorizzato(request: Request): boolean {
  const atteso = process.env.CRON_SECRET;
  if (!atteso) return false;

  const header = request.headers.get("authorization");
  if (header === `Bearer ${atteso}`) return true;

  // Comodo per un run manuale da browser o curl.
  const url = new URL(request.url);
  return url.searchParams.get("secret") === atteso;
}

export async function GET(request: Request) {
  if (!autorizzato(request)) {
    return NextResponse.json({ errore: "Non autorizzato" }, { status: 401 });
  }

  const inizio = Date.now();

  try {
    const fonti = await runAllScrapers();

    const nuovi = fonti.flatMap((f) => f.nuovi);
    const aggiornati = fonti.flatMap((f) => f.aggiornati);

    const scoring = await valutaNuoviBandi(nuovi);
    // Recupera anche i bandi rimasti senza punteggio per un errore precedente.
    const recuperati = await valutaBandiSenzaPunteggio();

    const digest = await preparaDigest({ nuovi, aggiornati, fonti });
    const invio = await inviaDigest(digest);

    return NextResponse.json({
      ok: true,
      durataMs: Date.now() - inizio,
      fonti: fonti.map((f) => ({
        fonte: f.fonte,
        ok: f.ok,
        totali: f.totaliTrovati,
        nuovi: f.nuovi.length,
        aggiornati: f.aggiornati.length,
        warnings: f.warnings,
        errore: f.errore,
      })),
      scoring: { ...scoring, recuperati },
      digest: {
        oggetto: digest.subject,
        vuoto: digest.vuoto,
        inviato: invio.inviato,
        motivo: invio.motivo,
      },
    });
  } catch (error) {
    // Un errore qui è del pipeline, non di una fonte: le fonti si gestiscono da sole.
    return NextResponse.json(
      {
        ok: false,
        errore: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
