import { defineConfig } from "vitest/config";
import { middlewareAliases } from "./vitest.aliases";

/**
 * Queue tests exercise real Redis + BullMQ (retry, backoff, dead-letter,
 * concurrency, graceful shutdown). They are NEVER mocked or bypassed:
 * if Redis is not reachable the run FAILS with an explicit message.
 *
 * Run with: pnpm test:queue   (requires Redis on REDIS_HOST:REDIS_PORT)
 */
export default defineConfig({
  resolve: {
    alias: middlewareAliases,
  },
  test: {
    name: "queue",
    environment: "node",
    include: ["tests/queue/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
    pool: "forks",
    setupFiles: ["./tests/setup-env.ts"],
    globalSetup: ["./tests/queue/require-redis.global-setup.ts"],
  },
});
