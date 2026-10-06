import { assertSafeDatabaseUrl } from "@middleware/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

export type Database = PrismaClient;

let client: Database | null = null;

/**
 * Creates (or returns) the process-wide Prisma client.
 *
 * SAFETY: `assertSafeDatabaseUrl` runs BEFORE the first connection — in
 * development it refuses anything except the dedicated `middleware` database
 * and always refuses `dct_crm` (and system databases) in every environment.
 */
export function getPrisma(): Database {
  if (client) return client;
  const url = process.env.DATABASE_URL ?? "";
  assertSafeDatabaseUrl(url);
  client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, max: 10 }),
  });
  return client;
}

/** For tests that need an isolated client against the same safety rules. */
export function createPrismaClient(connectionString?: string): Database {
  const url = connectionString ?? process.env.DATABASE_URL ?? "";
  assertSafeDatabaseUrl(url);
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, max: 5 }),
  });
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}

export { PrismaClient } from "./generated/client";
export { Prisma } from "./generated/client";
