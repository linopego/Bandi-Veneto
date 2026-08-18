import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { env } from "./env";
import { prisma } from "./prisma";
import type { EsitoBando } from "./pipeline";

/**
 * Punteggio di rilevanza 0-5 per una specifica azienda: ristorazione, eventi e
 * locali di intrattenimento in provincia di Vicenza.
 *
 * Il formato della risposta è imposto con gli structured output (`output_config
 * .format`), non chiesto a parole: il modello non può restituire markdown o
 * testo attorno al JSON, e `parsed_output` è già validato contro lo schema.
 */

const RilevanzaSchema = z.object({
  punteggio: z
    .number()
    .int()
    .min(0)
    .max(5)
    .describe("0 = irrilevante, 5 = da candidarsi subito"),
  motivo: z
    .string()
    .describe("Una riga in italiano che spiega il punteggio, massimo 200 caratteri"),
});

const PROFILO_AZIENDA = `L'azienda da valutare:
- settore: ristorazione, organizzazione di eventi, locali di intrattenimento
- sede e attività: provincia di Vicenza, Veneto
- dimensione: PMI

Alza il punteggio quando il bando tocca questi temi:
turismo; ristorazione e somministrazione; eventi e cultura; efficientamento
energetico; digitalizzazione delle PMI; assunzioni, tirocini e formazione;
rigenerazione urbana e distretti del commercio.

Abbassa il punteggio quando il bando è rivolto a soggetti che l'azienda non è
(enti pubblici, comuni, scuole, associazioni di volontariato, agricoltura,
pesca, industria pesante), a territori fuori dal Veneto, o è un concorso per
assunzioni nella pubblica amministrazione.

Scala: 0 nessun collegamento; 1 marginale; 2 possibile ma con requisiti
lontani; 3 pertinente ma non prioritario; 4 pertinente e accessibile;
5 centrato sull'attività e con scadenza utile.`;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export interface Rilevanza {
  punteggio: number;
  motivo: string;
}

/** Valuta un singolo bando. Rilancia: la gestione degli errori sta nel chiamante. */
export async function valutaRilevanza(input: {
  titolo: string;
  descrizione?: string | null;
  ente?: string | null;
  tipo?: string | null;
  beneficiari?: string | null;
}): Promise<Rilevanza> {
  const testo = [
    `Titolo: ${input.titolo}`,
    input.tipo ? `Tipo: ${input.tipo}` : null,
    input.ente ? `Ente: ${input.ente}` : null,
    input.beneficiari ? `Beneficiari: ${input.beneficiari}` : null,
    input.descrizione ? `Descrizione: ${input.descrizione}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await getClient().messages.parse({
    model: env.anthropicModel,
    max_tokens: 1000,
    system: PROFILO_AZIENDA,
    messages: [
      {
        role: "user",
        content: `Valuta la rilevanza di questo bando per l'azienda descritta.\n\n${testo}`,
      },
    ],
    output_config: { format: zodOutputFormat(RilevanzaSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("Il modello non ha restituito un punteggio interpretabile.");
  }
  return { punteggio: parsed.punteggio, motivo: parsed.motivo.trim() };
}

/**
 * Assegna un punteggio ai bandi appena raccolti e lo salva.
 *
 * Un errore su un singolo bando non ferma gli altri: resta con rilevanza null,
 * viene comunque mostrato in dashboard e verrà rivalutato al run successivo.
 */
export async function valutaNuoviBandi(
  nuovi: EsitoBando[],
): Promise<{ valutati: number; falliti: number }> {
  if (nuovi.length === 0) return { valutati: 0, falliti: 0 };
  if (!env.hasAnthropic) {
    console.warn("[scoring] ANTHROPIC_API_KEY assente: scoring saltato.");
    return { valutati: 0, falliti: nuovi.length };
  }

  let valutati = 0;
  let falliti = 0;

  for (const esito of nuovi) {
    try {
      const rilevanza = await valutaRilevanza(esito.bando);
      const aggiornato = await prisma.bando.update({
        where: { id: esito.bando.id },
        data: {
          rilevanza: rilevanza.punteggio,
          rilevanzaMotivo: rilevanza.motivo,
        },
      });
      // Il digest legge da questo oggetto: va tenuto allineato al DB.
      esito.bando = aggiornato;
      valutati++;
    } catch (error) {
      falliti++;
      console.error(
        `[scoring] fallita valutazione di "${esito.bando.titolo}":`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return { valutati, falliti };
}

/** Rivaluta i bandi rimasti senza punteggio per un errore di un run precedente. */
export async function valutaBandiSenzaPunteggio(limite = 25): Promise<number> {
  if (!env.hasAnthropic) return 0;
  const daValutare = await prisma.bando.findMany({
    where: { rilevanza: null, archiviato: false },
    orderBy: { primoRilevamento: "desc" },
    take: limite,
  });

  let valutati = 0;
  for (const bando of daValutare) {
    try {
      const rilevanza = await valutaRilevanza(bando);
      await prisma.bando.update({
        where: { id: bando.id },
        data: { rilevanza: rilevanza.punteggio, rilevanzaMotivo: rilevanza.motivo },
      });
      valutati++;
    } catch (error) {
      console.error(
        `[scoring] rivalutazione fallita per "${bando.titolo}":`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return valutati;
}
