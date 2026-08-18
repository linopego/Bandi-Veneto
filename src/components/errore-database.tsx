import Link from "next/link";
import type { DiagnosiDatabase } from "@/lib/diagnostica";

/**
 * Pannello mostrato al posto dei dati quando il database non risponde.
 * Dice cosa manca e come rimediare, invece di lasciare un 500 muto.
 */
export function ErroreDatabase({ diagnosi }: { diagnosi: DiagnosiDatabase }) {
  return (
    <div className="flex flex-col gap-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Database non disponibile
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Stato rilevato: <strong>{diagnosi.stato}</strong>
        </p>
      </div>

      <div className="rounded-lg border p-4 text-sm leading-relaxed">
        <p className="font-medium">Cosa fare</p>
        <p className="text-muted-foreground mt-1">{diagnosi.cosaFare}</p>
        <p className="mt-3">
          <Link
            href="/api/health"
            prefetch={false}
            className="underline underline-offset-4"
          >
            Apri /api/health
          </Link>{" "}
          <span className="text-muted-foreground">
            per il quadro completo di variabili d&apos;ambiente e stato del database.
          </span>
        </p>
      </div>
    </div>
  );
}
