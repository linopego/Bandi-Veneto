/** Formattazioni condivise fra digest email e dashboard. */

const FORMATTER_DATA = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Rome",
});

const FORMATTER_DATA_ORA = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Rome",
});

export function formatData(value: Date | null | undefined): string {
  return value ? FORMATTER_DATA.format(value) : "—";
}

export function formatDataOra(value: Date | null | undefined): string {
  return value ? FORMATTER_DATA_ORA.format(value) : "—";
}

/** Giorni interi da oggi alla scadenza; negativo se già passata. */
export function giorniAllaScadenza(
  scadenza: Date | null | undefined,
  adesso: Date = new Date(),
): number | null {
  if (!scadenza) return null;
  const giorno = 24 * 60 * 60 * 1000;
  const oggi = Date.UTC(adesso.getUTCFullYear(), adesso.getUTCMonth(), adesso.getUTCDate());
  const fine = Date.UTC(
    scadenza.getUTCFullYear(),
    scadenza.getUTCMonth(),
    scadenza.getUTCDate(),
  );
  return Math.round((fine - oggi) / giorno);
}

export function etichettaScadenza(scadenza: Date | null | undefined): string {
  const giorni = giorniAllaScadenza(scadenza);
  if (giorni === null) return "senza scadenza";
  if (giorni < 0) return `scaduto da ${Math.abs(giorni)} g`;
  if (giorni === 0) return "scade oggi";
  if (giorni === 1) return "scade domani";
  return `fra ${giorni} giorni`;
}

/** Escape per interpolare testo dentro l'HTML dell'email. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
