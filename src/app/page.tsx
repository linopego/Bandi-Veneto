import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { Rilevanza } from "@/components/rilevanza";
import { ScadenzaBadge } from "@/components/scadenza-badge";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatData } from "@/lib/format";
import { diagnosiDatabase } from "@/lib/diagnostica";
import { ErroreDatabase } from "@/components/errore-database";
import { prisma } from "@/lib/prisma";
import { scrapers } from "@/lib/scrapers";

/**
 * Elenco bandi con filtri.
 *
 * I filtri stanno tutti nella querystring: la pagina resta un server component
 * senza stato client, e un filtro impostato è un URL condivisibile e
 * ricaricabile.
 */

export const dynamic = "force-dynamic";

const OPZIONI_SCADENZA = {
  tutte: "Tutte",
  attivi: "Ancora aperti",
  "7": "Entro 7 giorni",
  "15": "Entro 15 giorni",
  "30": "Entro 30 giorni",
  scaduti: "Già scaduti",
} as const;

function costruisciWhere(params: Record<string, string>): Prisma.BandoWhereInput {
  const where: Prisma.BandoWhereInput = {};
  const and: Prisma.BandoWhereInput[] = [];

  where.archiviato = params.archiviati === "1" ? true : false;

  if (params.tipo) where.tipo = params.tipo;
  if (params.fonte) where.fonte = params.fonte;

  if (params.rilevanza) {
    const minima = Number(params.rilevanza);
    if (Number.isFinite(minima)) where.rilevanza = { gte: minima };
  }

  const adesso = new Date();
  switch (params.scadenza) {
    case "attivi":
      and.push({ OR: [{ dataScadenza: { gte: adesso } }, { dataScadenza: null }] });
      break;
    case "scaduti":
      and.push({ dataScadenza: { lt: adesso } });
      break;
    case "7":
    case "15":
    case "30": {
      const giorni = Number(params.scadenza);
      and.push({
        dataScadenza: {
          gte: adesso,
          lte: new Date(adesso.getTime() + giorni * 86400000),
        },
      });
      break;
    }
  }

  if (params.q) {
    const q = params.q.trim();
    if (q) {
      and.push({
        OR: [
          { titolo: { contains: q, mode: "insensitive" } },
          { descrizione: { contains: q, mode: "insensitive" } },
          { ente: { contains: q, mode: "insensitive" } },
          { beneficiari: { contains: q, mode: "insensitive" } },
          { categorie: { has: q } },
        ],
      });
    }
  }

  if (and.length > 0) where.AND = and;
  return where;
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const raw = await searchParams;
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params[key] = value;
  }

  const where = costruisciWhere(params);

  // Se il database non risponde la pagina spiega cosa manca invece di
  // restituire un 500 muto: al primo deploy è quasi sempre configurazione.
  let bandi, tipiDistinti, totaleArchiviati;
  try {
    [bandi, tipiDistinti, totaleArchiviati] = await Promise.all([
      prisma.bando.findMany({
        where,
        orderBy: [{ rilevanza: "desc" }, { dataScadenza: "asc" }],
        take: 200,
      }),
      prisma.bando.findMany({
        distinct: ["tipo"],
        select: { tipo: true },
        orderBy: { tipo: "asc" },
      }),
      prisma.bando.count({ where: { archiviato: true } }),
    ]);
  } catch (errore) {
    return <ErroreDatabase diagnosi={diagnosiDatabase(errore)} />;
  }

  const archiviatiAttivo = params.archiviati === "1";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {archiviatiAttivo ? "Bandi archiviati" : "Bandi"}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {bandi.length} risultati{bandi.length === 200 ? " (primi 200)" : ""}
        </p>
      </div>

      {/* GET su se stessa: i filtri finiscono nella querystring. */}
      <form className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <label className="text-muted-foreground mb-1 block text-xs" htmlFor="q">
            Ricerca
          </label>
          <Input
            id="q"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="titolo, ente, beneficiari…"
          />
        </div>

        <div>
          <label className="text-muted-foreground mb-1 block text-xs" htmlFor="tipo">
            Tipo
          </label>
          <Select id="tipo" name="tipo" defaultValue={params.tipo ?? ""}>
            <option value="">Tutti</option>
            {tipiDistinti.map((t) => (
              <option key={t.tipo} value={t.tipo}>
                {t.tipo}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label className="text-muted-foreground mb-1 block text-xs" htmlFor="fonte">
            Fonte
          </label>
          <Select id="fonte" name="fonte" defaultValue={params.fonte ?? ""}>
            <option value="">Tutte</option>
            {scrapers.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.nome}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label
            className="text-muted-foreground mb-1 block text-xs"
            htmlFor="rilevanza"
          >
            Rilevanza minima
          </label>
          <Select id="rilevanza" name="rilevanza" defaultValue={params.rilevanza ?? ""}>
            <option value="">Qualsiasi</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={String(n)}>
                {n}+ su 5
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label
            className="text-muted-foreground mb-1 block text-xs"
            htmlFor="scadenza"
          >
            Scadenza
          </label>
          <Select id="scadenza" name="scadenza" defaultValue={params.scadenza ?? ""}>
            {Object.entries(OPZIONI_SCADENZA).map(([value, label]) => (
              <option key={value} value={value === "tutte" ? "" : value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        {archiviatiAttivo && <input type="hidden" name="archiviati" value="1" />}

        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
          <Button type="submit" size="sm">
            Applica filtri
          </Button>
          <Link
            href={archiviatiAttivo ? "/?archiviati=1" : "/"}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Azzera
          </Link>
          <Link
            href={archiviatiAttivo ? "/" : "/?archiviati=1"}
            className="text-muted-foreground hover:text-foreground ml-auto text-sm underline-offset-4 hover:underline"
          >
            {archiviatiAttivo
              ? "Torna ai bandi attivi"
              : `Mostra archiviati (${totaleArchiviati})`}
          </Link>
        </div>
      </form>

      {bandi.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          Nessun bando corrisponde ai filtri.
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[45%]">Bando</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Scadenza</TableHead>
                <TableHead>Importo</TableHead>
                <TableHead>Rilevanza</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bandi.map((bando) => (
                <TableRow key={bando.id}>
                  <TableCell>
                    <Link
                      href={`/bando/${bando.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {bando.titolo}
                    </Link>
                    <div className="text-muted-foreground mt-1 text-xs">
                      {bando.ente ?? "ente non indicato"} · rilevato il{" "}
                      {formatData(bando.primoRilevamento)}
                    </div>
                    {bando.categorie.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {bando.categorie.map((categoria) => (
                          <Badge key={categoria} variant="outline">
                            {categoria}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{bando.tipo}</TableCell>
                  <TableCell>
                    <ScadenzaBadge scadenza={bando.dataScadenza} />
                  </TableCell>
                  <TableCell className="text-sm">{bando.importo ?? "—"}</TableCell>
                  <TableCell>
                    <Rilevanza valore={bando.rilevanza} />
                    {bando.rilevanzaMotivo && (
                      <p className="text-muted-foreground mt-1 max-w-[22ch] text-xs">
                        {bando.rilevanzaMotivo}
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
