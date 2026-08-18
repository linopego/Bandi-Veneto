import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { requireEnv } from "./env";

/**
 * Client Prisma a inizializzazione pigra.
 *
 * Il client viene costruito alla prima query, non all'import del modulo: in
 * fase di build Next importa le pagine per raccoglierne la configurazione, e
 * un client costruito subito farebbe fallire la build dove DATABASE_URL non
 * c'è (è il caso del build su Vercel, dove le variabili d'ambiente servono al
 * runtime e non alla compilazione).
 *
 * In sviluppo Next ricarica i moduli a ogni modifica: senza il singleton
 * globale si aprirebbe un pool di connessioni nuovo a ogni hot reload.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  // Prisma 7 richiede un driver adapter esplicito. Su Neon va usata la
  // connection string "pooled" (host -pooler), che regge le connessioni
  // brevi e numerose delle funzioni serverless.
  const adapter = new PrismaPg({ connectionString: requireEnv("DATABASE_URL") });
  return new PrismaClient({ adapter });
}

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
  }
  return globalForPrisma.prisma;
}

/**
 * Si usa come un normale PrismaClient (`prisma.bando.findMany()`): il proxy
 * si limita a rimandare al client vero, creandolo al primo accesso.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient();
    // Il receiver resta il client vero, non il proxy: eventuali getter interni
    // di Prisma devono girare con `this` sul client.
    const valore = Reflect.get(client, property, client);
    // Stesso motivo per i metodi: chiamati sul proxy perderebbero `this`.
    return typeof valore === "function" ? valore.bind(client) : valore;
  },
});
