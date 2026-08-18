"use client";

import Link from "next/link";

/**
 * Pagina di errore.
 *
 * Il caso di gran lunga più frequente al primo deploy è il database: variabile
 * DATABASE_URL non impostata o migrazioni non applicate. Invece di un 500 muto
 * la pagina dice cosa controllare e rimanda a /api/health, che dà la diagnosi
 * esatta.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">
        Qualcosa non ha funzionato
      </h1>
      <p className="text-muted-foreground text-sm leading-relaxed">
        La pagina non è riuscita a leggere i dati. Al primo deploy questo
        dipende quasi sempre dalla configurazione del database.
      </p>

      <div className="rounded-lg border p-4 text-sm leading-relaxed">
        <p className="font-medium">Cosa controllare, in ordine</p>
        <ol className="text-muted-foreground mt-2 list-decimal space-y-1 pl-5">
          <li>
            <code>DATABASE_URL</code> impostata nelle Environment Variables del
            progetto (su Neon la connection string <em>pooled</em>, host con{" "}
            <code>-pooler</code>).
          </li>
          <li>
            Migrazioni applicate:{" "}
            <code>npx prisma migrate deploy</code> con quella stessa{" "}
            <code>DATABASE_URL</code>.
          </li>
          <li>
            <code>CRON_SECRET</code> impostata, altrimenti il cron non parte.
          </li>
        </ol>
        <p className="mt-3">
          <Link
            href="/api/health"
            className="underline underline-offset-4"
            prefetch={false}
          >
            Apri /api/health
          </Link>{" "}
          <span className="text-muted-foreground">
            per sapere quale dei tre manca.
          </span>
        </p>
      </div>

      {error.digest && (
        <p className="text-muted-foreground font-mono text-xs">
          digest: {error.digest}
        </p>
      )}

      <div>
        <button
          type="button"
          onClick={reset}
          className="border-input hover:bg-accent h-9 rounded-md border px-4 text-sm font-medium"
        >
          Riprova
        </button>
      </div>
    </div>
  );
}
