import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDataOra } from "@/lib/format";
import { diagnosiDatabase } from "@/lib/diagnostica";
import { ErroreDatabase } from "@/components/errore-database";
import { prisma } from "@/lib/prisma";
import { scrapers } from "@/lib/scrapers";

/**
 * Esito degli ultimi scraping.
 *
 * Serve a una domanda sola: un parser si è rotto? Per questo in cima c'è lo
 * stato per fonte — quando è andata bene l'ultima volta e quante voci ha
 * visto — e sotto lo storico dei run.
 */

export const dynamic = "force-dynamic";

function VariantEsito({ esito }: { esito: string }) {
  const variant =
    esito === "OK" ? "success" : esito === "PARZIALE" ? "warning" : "destructive";
  return <Badge variant={variant}>{esito}</Badge>;
}

export default async function Runs() {
  let runs, ultimiPerFonte;
  try {
    [runs, ultimiPerFonte] = await Promise.all([
    prisma.scrapeRun.findMany({ orderBy: { timestamp: "desc" }, take: 100 }),
    Promise.all(
      scrapers.map(async (scraper) => ({
        scraper,
        ultimo: await prisma.scrapeRun.findFirst({
          where: { fonte: scraper.slug },
          orderBy: { timestamp: "desc" },
        }),
        ultimoOk: await prisma.scrapeRun.findFirst({
          where: { fonte: scraper.slug, esito: "OK" },
          orderBy: { timestamp: "desc" },
        }),
      })),
      ),
    ]);
  } catch (errore) {
    return <ErroreDatabase diagnosi={diagnosiDatabase(errore)} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Scraping</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Stato delle fonti ed esito degli ultimi run.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {ultimiPerFonte.map(({ scraper, ultimo, ultimoOk }) => (
          <Card key={scraper.slug}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 text-sm">
                <span>{scraper.nome}</span>
                {ultimo ? (
                  <VariantEsito esito={ultimo.esito} />
                ) : (
                  <Badge variant="outline">mai eseguito</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground flex flex-col gap-1 text-sm">
              <span className="font-mono text-xs break-all">{scraper.entryUrl}</span>
              {ultimo ? (
                <>
                  <span>
                    Ultimo run: {formatDataOra(ultimo.timestamp)} · {ultimo.totaliTrovati}{" "}
                    voci · {ultimo.nuoviTrovati} nuove · {ultimo.aggiornati} aggiornate
                  </span>
                  {ultimo.esito !== "OK" && (
                    <span>
                      Ultimo run riuscito:{" "}
                      {ultimoOk ? formatDataOra(ultimoOk.timestamp) : "mai"}
                    </span>
                  )}
                  {ultimo.errore && (
                    <span className="text-destructive break-words">{ultimo.errore}</span>
                  )}
                </>
              ) : (
                <span>Nessun run registrato per questa fonte.</span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quando</TableHead>
              <TableHead>Fonte</TableHead>
              <TableHead>Esito</TableHead>
              <TableHead>Voci</TableHead>
              <TableHead>Nuovi</TableHead>
              <TableHead>Aggiornati</TableHead>
              <TableHead>Pagine</TableHead>
              <TableHead>Durata</TableHead>
              <TableHead className="w-[30%]">Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 ? (
              <TableRow>
                <TableCell className="text-muted-foreground p-6 text-center text-sm">
                  Nessuno scraping registrato.
                </TableCell>
              </TableRow>
            ) : (
              runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="text-sm whitespace-nowrap">
                    {formatDataOra(run.timestamp)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{run.fonte}</TableCell>
                  <TableCell>
                    <VariantEsito esito={run.esito} />
                  </TableCell>
                  <TableCell className="text-sm">{run.totaliTrovati}</TableCell>
                  <TableCell className="text-sm">{run.nuoviTrovati}</TableCell>
                  <TableCell className="text-sm">{run.aggiornati}</TableCell>
                  <TableCell className="text-sm">{run.paginePercorse}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    {(run.durataMs / 1000).toFixed(1)} s
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs break-words">
                    {run.errore ?? "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
