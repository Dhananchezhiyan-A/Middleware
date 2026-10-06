import { defineConfig } from "vitest/config";
import { middlewareAliases } from "./vitest.aliases";

/**
 * Integration tests exercise the real PostgreSQL database through Prisma.
 * They require DATABASE_URL to point at the dedicated `middleware` database
 * (enforced by the application's safety guard).
 *
 * Run with: pnpm test:integration
 */
export default defineConfig({
  resolve: {
    alias: middlewareAliases,
  },
  test: {
    name: "integration",
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    setupFiles: ["./tests/setup-env.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
    // DB-backed tests run sequentially to avoid cross-test schema/data races.
    fileParallelism: false,
    pool: "forks",
  },
});
