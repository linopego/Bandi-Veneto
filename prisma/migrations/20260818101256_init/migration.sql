-- CreateEnum
CREATE TYPE "EsitoScrape" AS ENUM ('OK', 'PARZIALE', 'ERRORE');

-- CreateTable
CREATE TABLE "Bando" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "titolo" TEXT NOT NULL,
    "ente" TEXT,
    "descrizione" TEXT,
    "url" TEXT NOT NULL,
    "dataPubblicazione" TIMESTAMP(3),
    "dataScadenza" TIMESTAMP(3),
    "importo" TEXT,
    "beneficiari" TEXT,
    "categorie" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rilevanza" INTEGER,
    "rilevanzaMotivo" TEXT,
    "contentHash" TEXT NOT NULL,
    "primoRilevamento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimaModifica" TIMESTAMP(3) NOT NULL,
    "notificatoIl" TIMESTAMP(3),
    "archiviato" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Bando_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BandoModifica" (
    "id" TEXT NOT NULL,
    "bandoId" TEXT NOT NULL,
    "campo" TEXT NOT NULL,
    "valorePrima" TEXT,
    "valoreDopo" TEXT,
    "rilevatoIl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BandoModifica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeRun" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fonte" TEXT NOT NULL,
    "esito" "EsitoScrape" NOT NULL,
    "totaliTrovati" INTEGER NOT NULL DEFAULT 0,
    "nuoviTrovati" INTEGER NOT NULL DEFAULT 0,
    "aggiornati" INTEGER NOT NULL DEFAULT 0,
    "paginePercorse" INTEGER NOT NULL DEFAULT 0,
    "durataMs" INTEGER NOT NULL DEFAULT 0,
    "errore" TEXT,

    CONSTRAINT "ScrapeRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Bando_sourceId_key" ON "Bando"("sourceId");

-- CreateIndex
CREATE INDEX "Bando_fonte_idx" ON "Bando"("fonte");

-- CreateIndex
CREATE INDEX "Bando_tipo_idx" ON "Bando"("tipo");

-- CreateIndex
CREATE INDEX "Bando_dataScadenza_idx" ON "Bando"("dataScadenza");

-- CreateIndex
CREATE INDEX "Bando_rilevanza_idx" ON "Bando"("rilevanza");

-- CreateIndex
CREATE INDEX "Bando_archiviato_dataScadenza_idx" ON "Bando"("archiviato", "dataScadenza");

-- CreateIndex
CREATE INDEX "Bando_primoRilevamento_idx" ON "Bando"("primoRilevamento");

-- CreateIndex
CREATE INDEX "BandoModifica_bandoId_rilevatoIl_idx" ON "BandoModifica"("bandoId", "rilevatoIl");

-- CreateIndex
CREATE INDEX "ScrapeRun_timestamp_idx" ON "ScrapeRun"("timestamp");

-- CreateIndex
CREATE INDEX "ScrapeRun_fonte_timestamp_idx" ON "ScrapeRun"("fonte", "timestamp");

-- AddForeignKey
ALTER TABLE "BandoModifica" ADD CONSTRAINT "BandoModifica_bandoId_fkey" FOREIGN KEY ("bandoId") REFERENCES "Bando"("id") ON DELETE CASCADE ON UPDATE CASCADE;
