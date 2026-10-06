import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI configuration (Prisma ORM v7).
 *
 * DATA SAFETY: `DATABASE_URL` must point at the dedicated `middleware`
 * database during development. The PrismaClient factory in
 * @middleware/database enforces the same rule at runtime.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // process.env (not env()) so commands that don't need a DB — e.g.
    // `prisma generate` in CI — still work without a configured URL.
    url: process.env.DATABASE_URL ?? "",
    // Required by `prisma migrate dev` to replay migrations when generating a
    // new one. Derived from DATABASE_URL so no credentials are duplicated here.
    shadowDatabaseUrl: (process.env.DATABASE_URL ?? "").replace(
      /^(postgresql:\/\/[^/]+\/)[^?]*/,
      "$1prisma_shadow_middleware",
    ),
  },
});
