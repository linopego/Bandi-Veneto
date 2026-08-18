import { NextResponse } from "next/server";
import { diagnosiDatabase, type StatoDatabase } from "@/lib/diagnostica";
import { prisma } from "@/lib/prisma";

/**
 * Diagnostica del deploy.
 *
 * Serve a rispondere in un colpo solo alla domanda "perché la dashboard dà
 * errore": quali variabili d'ambiente mancano, se il database risponde e se le
 * migrazioni sono state applicate.
 *
 * Non espone mai valori: solo se una variabile è presente o no. Il messaggio
 * d'errore grezzo del database viene incluso solo passando il CRON_SECRET
 * (`?secret=…`), perché può contenere host e nomi utente.
 */

export const dynamic = "force-dynamic";

function presenza(nome: string): boolean {
  return Boolean(process.env[nome]);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const segretoCorretto =
    Boolean(process.env.CRON_SECRET) &&
    url.searchParams.get("secret") === process.env.CRON_SECRET;

  const variabili = {
    DATABASE_URL: presenza("DATABASE_URL"),
    CRON_SECRET: presenza("CRON_SECRET"),
    ANTHROPIC_API_KEY: presenza("ANTHROPIC_API_KEY"),
    RESEND_API_KEY: presenza("RESEND_API_KEY"),
    DIGEST_FROM: presenza("DIGEST_FROM"),
    DIGEST_TO: presenza("DIGEST_TO"),
  };

  let stato: StatoDatabase = "ok";
  let cosaFare: string | undefined;
  let messaggioOriginale: string | undefined;
  let conteggi: { bandi: number; run: number } | undefined;

  try {
    conteggi = {
      bandi: await prisma.bando.count(),
      run: await prisma.scrapeRun.count(),
    };
  } catch (errore) {
    const esito = diagnosiDatabase(errore);
    stato = esito.stato;
    cosaFare = esito.cosaFare;
    if (segretoCorretto) {
      messaggioOriginale = errore instanceof Error ? errore.message : String(errore);
    }
  }

  const mancanti = Object.entries(variabili)
    .filter(([, presente]) => !presente)
    .map(([nome]) => nome);

  const ok = stato === "ok" && variabili.DATABASE_URL && variabili.CRON_SECRET;

  return NextResponse.json(
    {
      ok,
      database: { stato, cosaFare, messaggioOriginale, ...conteggi },
      variabiliPresenti: variabili,
      variabiliMancanti: mancanti,
      note: mancanti.length
        ? "Senza ANTHROPIC_API_KEY i bandi restano senza punteggio; senza RESEND_API_KEY/DIGEST_FROM/DIGEST_TO il digest viene costruito ma non spedito. DATABASE_URL e CRON_SECRET sono invece indispensabili."
        : undefined,
    },
    { status: ok ? 200 : 503 },
  );
}
