import Link from "next/link";
import { notFound } from "next/navigation";
import { Rilevanza } from "@/components/rilevanza";
import { ScadenzaBadge } from "@/components/scadenza-badge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatData, formatDataOra } from "@/lib/format";
import { diagnosiDatabase } from "@/lib/diagnostica";
import { ErroreDatabase } from "@/components/errore-database";
import { prisma } from "@/lib/prisma";

/** Dettaglio di un bando, con lo storico delle modifiche rilevate alla fonte. */

export const dynamic = "force-dynamic";

/** Nomi leggibili dei campi, per lo storico. */
const NOMI_CAMPI: Record<string, string> = {
  titolo: "Titolo",
  tipo: "Tipo",
  ente: "Ente",
  descrizione: "Descrizione",
  url: "Link",
  dataPubblicazione: "Data di pubblicazione",
  dataScadenza: "Data di scadenza",
  importo: "Importo",
  beneficiari: "Beneficiari",
  categorie: "Categorie",
};

/** I campi data sono salvati in ISO nello storico: qui vanno mostrati all'italiana. */
function valoreLeggibile(campo: string, valore: string | null): string {
  if (!valore) return "—";
  if (campo === "dataScadenza" || campo === "dataPubblicazione") {
    const data = new Date(`${valore}T12:00:00Z`);
    if (!Number.isNaN(data.getTime())) return formatData(data);
  }
  return valore;
}

export default async function DettaglioBando({ params }: PageProps<"/bando/[id]">) {
  const { id } = await params;

  let bando;
  try {
    bando = await prisma.bando.findUnique({
      where: { id },
      include: { modifiche: { orderBy: { rilevatoIl: "desc" } } },
    });
  } catch (errore) {
    return <ErroreDatabase diagnosi={diagnosiDatabase(errore)} />;
  }

  if (!bando) notFound();

  const campi: Array<[string, string]> = [
    ["Ente", bando.ente ?? "—"],
    ["Tipo", bando.tipo],
    ["Fonte", bando.fonte],
    ["Pubblicazione", formatData(bando.dataPubblicazione)],
    ["Importo", bando.importo ?? "—"],
    ["Beneficiari", bando.beneficiari ?? "—"],
    ["Primo rilevamento", formatDataOra(bando.primoRilevamento)],
    ["Ultima modifica", formatDataOra(bando.ultimaModifica)],
    [
      "Inserito nel digest",
      bando.notificatoIl ? formatDataOra(bando.notificatoIl) : "non ancora",
    ],
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
        >
          ← Tutti i bandi
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{bando.titolo}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Rilevanza valore={bando.rilevanza} />
          <ScadenzaBadge scadenza={bando.dataScadenza} />
          {bando.archiviato && <Badge variant="outline">archiviato</Badge>}
        </div>
        {bando.rilevanzaMotivo && (
          <p className="text-muted-foreground mt-3 text-sm">{bando.rilevanzaMotivo}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href={bando.url}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ size: "sm" })}
        >
          Apri sul sito della Regione
        </a>
      </div>

      {bando.descrizione && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Descrizione</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed">
            {bando.descrizione}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Dati</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            {campi.map(([etichetta, valore]) => (
              <div key={etichetta} className="flex flex-col">
                <dt className="text-muted-foreground text-xs">{etichetta}</dt>
                <dd className="text-sm break-words">{valore}</dd>
              </div>
            ))}
          </dl>
          {bando.categorie.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1">
              {bando.categorie.map((categoria) => (
                <Badge key={categoria} variant="outline">
                  {categoria}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Storico modifiche ({bando.modifiche.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {bando.modifiche.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nessuna modifica rilevata dal primo salvataggio.
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {bando.modifiche.map((modifica) => (
                <li key={modifica.id} className="border-l-2 pl-4 text-sm">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">
                      {NOMI_CAMPI[modifica.campo] ?? modifica.campo}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {formatDataOra(modifica.rilevatoIl)}
                    </span>
                  </div>
                  <div className="mt-1 grid gap-1 sm:grid-cols-2">
                    <div className="text-muted-foreground break-words line-through">
                      {valoreLeggibile(modifica.campo, modifica.valorePrima)}
                    </div>
                    <div className="break-words">
                      {valoreLeggibile(modifica.campo, modifica.valoreDopo)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
