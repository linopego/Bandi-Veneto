/**
 * Accesso centralizzato alle variabili d'ambiente.
 *
 * Le variabili non sono validate all'import: la dashboard deve poter girare
 * anche senza le chiavi di Resend o Anthropic. Ogni modulo richiede quello che
 * gli serve con `requireEnv` nel momento in cui serve davvero.
 */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variabile d'ambiente mancante: ${name}. Vedi .env.example per l'elenco completo.`,
    );
  }
  return value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  get bandiVenetoBaseUrl(): string {
    return (
      process.env.BANDI_VENETO_BASE_URL ?? "https://bandi.regione.veneto.it"
    ).replace(/\/$/, "");
  },
  get scraperContact(): string {
    return process.env.SCRAPER_CONTACT ?? "";
  },
  get scraperDelayMs(): number {
    return num("SCRAPER_DELAY_MS", 1500);
  },
  get scraperMaxPages(): number {
    return num("SCRAPER_MAX_PAGES", 25);
  },
  get anthropicModel(): string {
    return process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
  },
  get hasAnthropic(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  },
  get hasResend(): boolean {
    return Boolean(process.env.RESEND_API_KEY);
  },
};
