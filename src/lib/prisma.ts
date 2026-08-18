import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { requireEnv } from "./env";

/**
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

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
