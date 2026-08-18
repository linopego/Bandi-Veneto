import { Resend } from "resend";
import type { Bando } from "@/generated/prisma/client";
import { env, requireEnv } from "./env";
import { escapeHtml, etichettaScadenza, formatData, giorniAllaScadenza } from "./format";
import type { EsitoBando, EsitoFonte } from "./pipeline";
import { prisma } from "./prisma";

/**
 * Digest giornaliero.
 *
 * Contenuto, nell'ordine:
 *  1. le scadenze entro 15 giorni sui bandi già salvati (il promemoria);
 *  2. i bandi nuovi, ordinati per rilevanza decrescente;
 *  3. i bandi già noti la cui scadenza è cambiata, marcati AGGIORNATO;
 *  4. eventuali fonti in errore, perché un digest vuoto per un parser rotto
 *     non deve sembrare un digest vuoto per assenza di novità.
 *
 * Se non c'è niente di nuovo il corpo è una riga sola: nessun riempitivo.
 */

const GIORNI_SCADENZA_IMMINENTE = 15;

export interface DigestInput {
  nuovi: EsitoBando[];
  aggiornati: EsitoBando[];
  fonti: EsitoFonte[];
}

export interface DigestPreparato {
  subject: string;
  html: string;
  text: string;
  /** Bandi inclusi come "nuovi": vanno marcati notificati dopo l'invio. */
  daMarcareNotificati: string[];
  vuoto: boolean;
}

function ordinaPerRilevanza(items: EsitoBando[]): EsitoBando[] {
  return [...items].sort((a, b) => {
    const ra = a.bando.rilevanza ?? -1;
    const rb = b.bando.rilevanza ?? -1;
    if (rb !== ra) return rb - ra;
    // A parità di punteggio viene prima chi scade prima.
    const sa = a.bando.dataScadenza?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const sb = b.bando.dataScadenza?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return sa - sb;
  });
}

/** Bandi già salvati che scadono entro 15 giorni, non archiviati. */
export async function scadenzeImminenti(): Promise<Bando[]> {
  const adesso = new Date();
  const limite = new Date(adesso.getTime() + GIORNI_SCADENZA_IMMINENTE * 86400000);
  return prisma.bando.findMany({
    where: {
      archiviato: false,
      dataScadenza: { gte: adesso, lte: limite },
    },
    orderBy: [{ dataScadenza: "asc" }, { rilevanza: "desc" }],
  });
}

function pallini(rilevanza: number | null): string {
  if (rilevanza === null) return "non valutato";
  return `${"●".repeat(rilevanza)}${"○".repeat(5 - rilevanza)} ${rilevanza}/5`;
}

function vocEmailHtml(bando: Bando, badge?: string): string {
  const righe: string[] = [];
  const meta = [
    bando.ente ? escapeHtml(bando.ente) : null,
    escapeHtml(bando.tipo),
  ]
    .filter(Boolean)
    .join(" · ");

  righe.push(
    `<tr><td style="padding:16px 0;border-bottom:1px solid #e5e7eb;">`,
    badge
      ? `<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;letter-spacing:.04em;padding:2px 8px;border-radius:4px;margin-bottom:6px;">${escapeHtml(badge)}</span><br>`
      : "",
    `<a href="${escapeHtml(bando.url)}" style="color:#1d4ed8;font-size:16px;font-weight:600;text-decoration:none;line-height:1.35;">${escapeHtml(bando.titolo)}</a>`,
    meta ? `<div style="color:#6b7280;font-size:13px;margin-top:4px;">${meta}</div>` : "",
    `<div style="color:#374151;font-size:13px;margin-top:8px;line-height:1.6;">`,
    `Scadenza: <strong>${formatData(bando.dataScadenza)}</strong> (${escapeHtml(etichettaScadenza(bando.dataScadenza))})`,
    bando.importo ? `<br>Importo: ${escapeHtml(bando.importo)}` : "",
    `<br>Rilevanza: <strong>${pallini(bando.rilevanza)}</strong>`,
    bando.rilevanzaMotivo
      ? `<br><span style="color:#6b7280;">${escapeHtml(bando.rilevanzaMotivo)}</span>`
      : "",
    `</div>`,
    `</td></tr>`,
  );
  return righe.join("");
}

function voceTesto(bando: Bando, badge?: string): string {
  return [
    `${badge ? `[${badge}] ` : ""}${bando.titolo}`,
    `  ${[bando.ente, bando.tipo].filter(Boolean).join(" · ")}`,
    `  Scadenza: ${formatData(bando.dataScadenza)} (${etichettaScadenza(bando.dataScadenza)})`,
    bando.importo ? `  Importo: ${bando.importo}` : null,
    `  Rilevanza: ${pallini(bando.rilevanza)}${bando.rilevanzaMotivo ? ` — ${bando.rilevanzaMotivo}` : ""}`,
    `  ${bando.url}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function sezione(titolo: string, corpo: string): string {
  if (!corpo) return "";
  return [
    `<tr><td style="padding:24px 0 4px;">`,
    `<h2 style="margin:0;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;font-weight:700;">${escapeHtml(titolo)}</h2>`,
    `</td></tr>`,
    corpo,
  ].join("");
}

export async function preparaDigest(input: DigestInput): Promise<DigestPreparato> {
  const nuovi = ordinaPerRilevanza(input.nuovi);
  // Solo le scadenze cambiate diventano "AGGIORNATO": il resto è rumore.
  const aggiornati = ordinaPerRilevanza(
    input.aggiornati.filter((a) => a.scadenzaCambiata),
  );
  const imminenti = await scadenzeImminenti();
  const fontiInErrore = input.fonti.filter((f) => !f.ok);

  const vuoto = nuovi.length === 0 && aggiornati.length === 0;
  const oggi = formatData(new Date());

  const subject = vuoto
    ? `Bandi Veneto — nessuna novità (${oggi})`
    : `Bandi Veneto — ${nuovi.length} nuovi${aggiornati.length > 0 ? `, ${aggiornati.length} aggiornati` : ""} (${oggi})`;

  const righeHtml: string[] = [];
  const righeTesto: string[] = [];

  if (imminenti.length > 0) {
    righeHtml.push(
      sezione(
        `In scadenza entro ${GIORNI_SCADENZA_IMMINENTE} giorni`,
        imminenti.map((b) => vocEmailHtml(b)).join(""),
      ),
    );
    righeTesto.push(
      `== IN SCADENZA ENTRO ${GIORNI_SCADENZA_IMMINENTE} GIORNI ==`,
      ...imminenti.map((b) => voceTesto(b)),
      "",
    );
  }

  if (vuoto) {
    const riga = "Nessuna nuova pubblicazione oggi.";
    righeHtml.push(
      `<tr><td style="padding:24px 0;color:#374151;font-size:14px;">${riga}</td></tr>`,
    );
    righeTesto.push(riga);
  } else {
    if (nuovi.length > 0) {
      righeHtml.push(
        sezione(
          `${nuovi.length} nuove pubblicazioni`,
          nuovi.map((n) => vocEmailHtml(n.bando)).join(""),
        ),
      );
      righeTesto.push(
        `== ${nuovi.length} NUOVE PUBBLICAZIONI ==`,
        ...nuovi.map((n) => voceTesto(n.bando)),
        "",
      );
    }
    if (aggiornati.length > 0) {
      righeHtml.push(
        sezione(
          "Scadenze cambiate",
          aggiornati.map((a) => vocEmailHtml(a.bando, "AGGIORNATO")).join(""),
        ),
      );
      righeTesto.push(
        "== SCADENZE CAMBIATE ==",
        ...aggiornati.map((a) => voceTesto(a.bando, "AGGIORNATO")),
        "",
      );
    }
  }

  if (fontiInErrore.length > 0) {
    const elenco = fontiInErrore
      .map((f) => `<li>${escapeHtml(f.nome)}: ${escapeHtml(f.errore ?? "errore sconosciuto")}</li>`)
      .join("");
    righeHtml.push(
      sezione(
        "Fonti in errore",
        `<tr><td style="padding:8px 0;"><ul style="margin:0;padding-left:18px;color:#b91c1c;font-size:13px;line-height:1.6;">${elenco}</ul></td></tr>`,
      ),
    );
    righeTesto.push(
      "== FONTI IN ERRORE ==",
      ...fontiInErrore.map((f) => `- ${f.nome}: ${f.errore}`),
    );
  }

  // Layout a tabella con max-width: è ciò che i client email renderizzano in
  // modo prevedibile, su desktop come su mobile.
  const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:#ffffff;border-radius:8px;padding:8px 24px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td style="padding:20px 0 0;">
<div style="font-size:18px;font-weight:700;color:#111827;">Bandi Regione Veneto</div>
<div style="font-size:13px;color:#6b7280;margin-top:2px;">Digest del ${escapeHtml(oggi)}</div>
</td></tr>
${righeHtml.join("")}
<tr><td style="padding:24px 0 0;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;line-height:1.5;">
Monitoraggio automatico delle pubblicazioni della Regione Veneto.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [`Bandi Regione Veneto — digest del ${oggi}`, "", ...righeTesto].join("\n");

  return {
    subject,
    html,
    text,
    daMarcareNotificati: nuovi.map((n) => n.bando.id),
    vuoto,
  };
}

export interface EsitoInvio {
  inviato: boolean;
  motivo?: string;
  id?: string;
}

/** Invia il digest con Resend e marca come notificati i bandi inclusi. */
export async function inviaDigest(digest: DigestPreparato): Promise<EsitoInvio> {
  if (!env.hasResend) {
    return { inviato: false, motivo: "RESEND_API_KEY non configurata" };
  }

  const resend = new Resend(requireEnv("RESEND_API_KEY"));
  const destinatari = requireEnv("DIGEST_TO")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

  const { data, error } = await resend.emails.send({
    from: requireEnv("DIGEST_FROM"),
    to: destinatari,
    subject: digest.subject,
    html: digest.html,
    text: digest.text,
  });

  if (error) {
    return { inviato: false, motivo: error.message };
  }

  if (digest.daMarcareNotificati.length > 0) {
    await prisma.bando.updateMany({
      where: { id: { in: digest.daMarcareNotificati } },
      data: { notificatoIl: new Date() },
    });
  }

  return { inviato: true, id: data?.id };
}

export { GIORNI_SCADENZA_IMMINENTE, giorniAllaScadenza };
