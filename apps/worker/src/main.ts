import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { assertSafeDatabaseUrl, getEnv } from "@middleware/config";
import { disconnectPrisma } from "@middleware/database";
import { AppModule } from "./app.module";

/**
 * Worker bootstrap — headless Nest application context (no HTTP listener).
 *
 * Order matters for data safety:
 *   1. Validate environment (fails fast on bad config).
 *   2. Assert DATABASE_URL is the dedicated `middleware` database
 *      (dct_crm and system databases are permanently blocked).
 *   3. Start queue consumers; WorkersService probes Redis and aborts with an
 *      actionable error if it is unreachable (no fake-running worker).
 */
async function bootstrap(): Promise<void> {
  const env = getEnv();
  assertSafeDatabaseUrl(env.DATABASE_URL);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log", "debug"],
  });
  app.enableShutdownHooks(); // SIGTERM/SIGINT → graceful worker close (in-flight jobs finish)

  await app.init();

  process.stdout.write(
    `[worker] started (env=${env.NODE_ENV}, redis=${env.REDIS_HOST}:${env.REDIS_PORT}, db=middleware)\n`,
  );
}

bootstrap().catch((err) => {
  process.stderr.write(`[worker] failed to start: ${String(err)}\n`);
  disconnectPrisma()
    .catch(() => undefined)
    .finally(() => process.exit(1));
});
