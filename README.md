# Bandi Veneto

Monitoraggio automatico dei bandi, avvisi e concorsi della Regione Veneto.

Ogni mattina uno scraper raccoglie le nuove pubblicazioni, salva a database solo
le novità, assegna a ognuna un punteggio di rilevanza con l'API Anthropic e
manda un digest via email. Una dashboard web permette di consultare lo storico,
filtrare e tenere d'occhio le scadenze imminenti.

Stack: Next.js (App Router) + TypeScript, Prisma + PostgreSQL (Neon), Tailwind
con componenti in stile shadcn/ui, deploy su Vercel con cron da `vercel.json`.

---

## ⚠️ Stato: il parser va verificato sull'HTML reale

Il parser della fonte Tipo=1 **non è ancora stato verificato contro l'HTML vero
di `bandi.regione.veneto.it`**: dall'ambiente in cui è stato sviluppato il
dominio non è raggiungibile (bloccato dal proxy di rete, HTTP 403 su CONNECT).

Di conseguenza:

- il parser **non si aggancia a classi o `id` CSS**, che sarebbero stati
  un'ipotesi non verificabile. Parte invece dai link al dettaglio
  (`/Public/Dettaglio?idAtto=NNNN`, struttura confermata dai risultati pubblici
  del portale) e da lì risale al blocco che contiene la voce, leggendo i campi
  per etichetta (`Ente:`, `Scadenza:`, …) e non per posizione;
- la paginazione gestisce **entrambi** i meccanismi ASP.NET, postback
  (`__doPostBack` + `__VIEWSTATE`) e querystring (`?page=2`), perché non è stato
  possibile osservare quale dei due usi il portale;
- tutta la catena — fetch, robots.txt, paginazione, parsing, deduplica,
  rilevamento modifiche, digest, dashboard — è stata **eseguita e verificata in
  locale** contro le fixture in `fixtures/`, che riproducono un elenco ASP.NET
  con `__VIEWSTATE` e paginazione via postback.

**Primo passo da fare da una rete che raggiunge il portale:**

```bash
npm run scrape:local -- --dry
```

Stampa quello che il parser vede senza scrivere nulla a database. Se i campi
escono vuoti o storti, le etichette da correggere stanno tutte in
`ETICHETTE` dentro `src/lib/scrapers/elenco-parser.ts`. Per lavorare su una
copia della pagina vera:

```bash
curl -A "BandiVenetoMonitor/1.0" \
  "https://bandi.regione.veneto.it/Public/Elenco?Tipo=1" \
  > fixtures/elenco-tipo1-pag1.html
npm run fixture:serve                       # in un terminale
BANDI_VENETO_BASE_URL=http://127.0.0.1:8787 npm run scrape:local -- --dry
```

---

## Variabili d'ambiente

Copiare `.env.example` in `.env` e valorizzare:

| Variabile | Obbligatoria | A cosa serve |
|---|---|---|
| `DATABASE_URL` | sì | Connection string PostgreSQL. Su Neon usare quella **pooled** (host `…-pooler…`). |
| `ANTHROPIC_API_KEY` | per lo scoring | Chiave API Anthropic. Senza, i bandi vengono salvati con rilevanza `null` e rivalutati al run successivo. |
| `ANTHROPIC_MODEL` | no | Default `claude-sonnet-4-6`. |
| `RESEND_API_KEY` | per il digest | Chiave API Resend. Senza, il digest viene costruito ma non spedito. |
| `DIGEST_FROM` | per il digest | Mittente, su un dominio verificato in Resend. Es. `Bandi Veneto <bandi@tuodominio.it>`. |
| `DIGEST_TO` | per il digest | Destinatario. Più indirizzi separati da virgola. |
| `CRON_SECRET` | sì | Protegge `/api/cron/scrape`. Stringa lunga e casuale. |
| `BANDI_VENETO_BASE_URL` | no | Default `https://bandi.regione.veneto.it`. Si sovrascrive solo per i test in locale. |
| `SCRAPER_CONTACT` | consigliata | Email esposta nello User-Agent: permette alla Regione di segnalare problemi invece di bloccare l'IP. |
| `SCRAPER_DELAY_MS` | no | Pausa fra richieste, default `1500`. |
| `SCRAPER_MAX_PAGES` | no | Tetto di pagine per fonte, default `25`. |

---

## Sviluppo in locale

Serve Node 20+ e un PostgreSQL raggiungibile.

```bash
npm install
cp .env.example .env          # e compilare almeno DATABASE_URL e CRON_SECRET
npx prisma migrate dev        # crea le tabelle
npm run dev                   # dashboard su http://localhost:3000
```

### Far girare lo scraper senza toccare il sito della Regione

```bash
npm run fixture:serve         # terminale 1: finto portale su :8787
BANDI_VENETO_BASE_URL=http://127.0.0.1:8787 npm run scrape:local
```

### Comandi dello scraper

```bash
npm run scrape:local              # scraping + salvataggio a DB
npm run scrape:local -- --dry     # solo parsing, non scrive nulla (diagnostica)
npm run scrape:local -- --score   # valuta la rilevanza (consuma API Anthropic)
npm run scrape:local -- --digest  # scrive il digest in tmp/digest.html
npm run scrape:local -- --send    # invia davvero l'email
```

### Far partire un run completo come lo farebbe il cron

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/scrape
```

---

## Come funziona

### Le fonti

Ogni fonte è un modulo in `src/lib/scrapers/` che espone l'interfaccia comune
`Scraper` (`src/lib/scrapers/types.ts`) e viene registrata in
`src/lib/scrapers/index.ts`. Il pipeline le esegue una per una, ognuna nel
proprio `try/catch`: se una si rompe, le altre girano lo stesso e l'errore
finisce in `ScrapeRun`, visibile in `/runs`.

Attiva al momento:

| Fonte | Slug | Stato |
|---|---|---|
| Bandi e Finanziamenti (`Tipo=1`) | `bandi-veneto-tipo1` | implementata |
| Avvisi (`Tipo=2`) | — | da aggiungere |
| Concorsi e Stage (`Tipo=3`) | — | da aggiungere |
| Scadenzario | — | da aggiungere |
| Veneto Innovazione (WordPress) | — | da aggiungere |
| BUR Veneto (RSS) | — | da aggiungere |

Tipo=2 e Tipo=3 condividono l'impianto di Tipo=1: si aggiungono con una riga in
`src/lib/scrapers/index.ts` usando `createElencoScraper`, una volta verificato
che gli elenchi abbiano davvero la stessa struttura.

### Educazione verso la fonte

Concentrata in `src/lib/http.ts`: User-Agent che dichiara cosa siamo e come
contattarci, pausa configurabile fra richieste allo stesso host, `robots.txt`
letto una volta per host e rispettato. Un `Disallow` che copre l'URL di partenza
ferma quella fonte con un errore esplicito, non la salta in silenzio.

### Deduplica e modifiche

L'identità di un bando è `sourceId`, un hash stabile. **Nota, differenza
rispetto alla specifica iniziale:** quando l'URL espone `idAtto` è quello a fare
da chiave, invece di `url + titolo`. Le pubblicazioni della PA vengono corrette
dopo la pubblicazione (un refuso nel titolo, una parola aggiunta): con il titolo
nella chiave, ogni correzione avrebbe creato un record nuovo e un falso "nuovo
bando" nel digest. Con `idAtto` la correzione risulta per quello che è, una
modifica sul record esistente. Il fallback `url + titolo` resta per le fonti
future senza identificativo.

Su un bando già noto vengono aggiornati **solo i campi cambiati**, e ogni
cambiamento lascia una riga in `BandoModifica` (visibile nello storico della
pagina di dettaglio). Se fra i campi cambiati c'è la scadenza, il bando compare
nel digest marcato `AGGIORNATO`. Il campo `notificatoIl` garantisce che un bando
già mandato non torni nel digest.

### Scoring di rilevanza

`src/lib/scoring.ts` chiama l'API Anthropic per ogni nuovo bando e chiede un
punteggio 0-5 per un'azienda di ristorazione, eventi e locali di intrattenimento
in provincia di Vicenza, più una riga di motivazione. Il formato della risposta
è imposto con gli **structured output** (`output_config.format` + schema Zod):
il modello non può restituire markdown attorno al JSON e la risposta è già
validata, senza parsing a mano.

Un errore su un singolo bando non ferma gli altri: quel bando resta con
rilevanza `null`, compare comunque in dashboard e viene ripreso al run
successivo da `valutaBandiSenzaPunteggio`.

### Digest

`src/lib/digest.ts`. In cima le scadenze entro 15 giorni sui bandi già salvati,
poi i nuovi ordinati per rilevanza decrescente, poi le scadenze cambiate, infine
le fonti in errore — così un digest vuoto per un parser rotto non si confonde
con un digest vuoto perché non c'è niente di nuovo. Se non c'è nulla di nuovo il
corpo è una riga sola. HTML a tabella con `max-width`, leggibile da mobile.

---

## Deploy su Vercel + Neon

### 1. Database su Neon

1. Creare un progetto su [neon.tech](https://neon.tech) (regione europea, es.
   Frankfurt).
2. Copiare la connection string **pooled** (l'host contiene `-pooler`): è quella
   che regge le connessioni brevi e numerose delle funzioni serverless.
3. Applicare le migrazioni al database di produzione:

   ```bash
   DATABASE_URL="<connection string Neon>" npx prisma migrate deploy
   ```

### 2. Progetto su Vercel

1. Importare il repository su Vercel; il framework viene riconosciuto da solo.
2. In **Settings → Environment Variables** inserire, per l'ambiente Production:
   `DATABASE_URL`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `DIGEST_FROM`,
   `DIGEST_TO`, `CRON_SECRET` e, se serve, `SCRAPER_CONTACT`.
3. Deploy. Lo script `postinstall` esegue `prisma generate` a ogni build.

Il `build` non applica le migrazioni: vanno lanciate a mano con
`prisma migrate deploy` quando lo schema cambia, così un deploy non altera mai
il database da solo.

### 3. Dominio mittente su Resend

Verificare il dominio in Resend (record DNS SPF e DKIM) e usare un indirizzo di
quel dominio in `DIGEST_FROM`. Un mittente non verificato fa fallire l'invio.

### 4. Cron

`vercel.json` registra il cron:

```json
{ "crons": [{ "path": "/api/cron/scrape", "schedule": "0 5 * * *" }] }
```

**I cron di Vercel girano in UTC** e non seguono l'ora legale. `0 5 * * *`
significa **7:00 in ora legale (da fine marzo a fine ottobre) e 6:00 in ora
solare**. Per avere le 7:00 tutto l'anno bisogna cambiare la riga a `0 6 * * *`
quando scatta l'ora solare, oppure — se l'orario esatto conta poco — lasciarla
così.

Vercel chiama l'endpoint con `Authorization: Bearer $CRON_SECRET`, che è quello
che `/api/cron/scrape` verifica. Sul piano Hobby i cron sono giornalieri e
l'orario è approssimativo.

---

## Struttura

```
prisma/schema.prisma          Bando, BandoModifica, ScrapeRun
src/lib/
  env.ts                      lettura variabili d'ambiente
  http.ts                     fetch educato: User-Agent, rate limit, robots.txt
  normalize.ts                date italiane, importi, sourceId, contentHash
  pipeline.ts                 scraping → deduplica → diff → database
  scoring.ts                  punteggio di rilevanza via API Anthropic
  digest.ts                   costruzione e invio del digest
  format.ts                   formattazioni condivise
  scrapers/
    types.ts                  interfaccia comune a tutte le fonti
    index.ts                  registro delle fonti attive
    elenco-parser.ts          parsing di una pagina di elenco
    pagination.ts             paginazione ASP.NET (postback e querystring)
    bandi-veneto-elenco.ts    fonte Tipo=1
src/app/
  page.tsx                    elenco con filtri e ricerca
  bando/[id]/page.tsx         dettaglio e storico modifiche
  runs/page.tsx               esito degli scraping
  api/cron/scrape/route.ts    endpoint del cron, protetto da CRON_SECRET
scripts/
  scrape-local.ts             runner da riga di comando
  serve-fixture.ts            finto portale per lo sviluppo in locale
fixtures/                     pagine di elenco per i test in locale
```

I componenti in `src/components/ui/` seguono le convenzioni di shadcn/ui
(stessi percorsi, stesso `cn()`, stessi token CSS) e `components.json` è già
configurato: `npx shadcn@latest add <componente>` funziona senza ritocchi.
