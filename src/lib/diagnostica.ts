/**
 * Traduzione degli errori del database in una diagnosi leggibile.
 *
 * Condivisa fra /api/health e le pagine: al primo deploy il motivo per cui la
 * dashboard non carica è quasi sempre uno di questi tre, e dirlo esplicitamente
 * vale più di uno stack trace.
 */

export type StatoDatabase =
  | "ok"
  | "non configurato"
  | "irraggiungibile"
  | "schema mancante"
  | "errore";

export interface DiagnosiDatabase {
  stato: StatoDatabase;
  cosaFare: string;
}

export function diagnosiDatabase(errore: unknown): DiagnosiDatabase {
  const messaggio = errore instanceof Error ? errore.message : String(errore);
  const codice =
    typeof errore === "object" && errore !== null && "code" in errore
      ? String((errore as { code: unknown }).code)
      : "";

  if (messaggio.includes("DATABASE_URL")) {
    return {
      stato: "non configurato",
      cosaFare:
        "Imposta DATABASE_URL nelle Environment Variables del progetto Vercel (su Neon usa la connection string pooled, host con -pooler) e rifai il deploy.",
    };
  }
  // P2021: tabella inesistente.
  if (codice === "P2021" || /does not exist/i.test(messaggio)) {
    return {
      stato: "schema mancante",
      cosaFare:
        'Le tabelle non ci sono: applica le migrazioni con DATABASE_URL="<stringa Neon>" npx prisma migrate deploy.',
    };
  }
  // P1001/P1002: database non raggiungibile.
  if (
    codice === "P1001" ||
    codice === "P1002" ||
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timeout/i.test(messaggio)
  ) {
    return {
      stato: "irraggiungibile",
      cosaFare:
        "Il database non risponde: controlla che la connection string sia quella pooled di Neon e che il progetto Neon non sia sospeso.",
    };
  }
  return {
    stato: "errore",
    cosaFare:
      "Errore non riconosciuto: apri /api/health?secret=<CRON_SECRET> per vedere il messaggio originale.",
  };
}
