import "reflect-metadata";
import fs from "node:fs";
import { ValidationPipe, VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { ZodValidationPipe } from "nestjs-zod";
import { getEnv } from "@middleware/config";
import { createLogger } from "@middleware/shared";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";

async function bootstrap(): Promise<void> {
  const env = getEnv();
  const logger = createLogger({ name: "api" });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Preserve the original bytes for webhook idempotency and raw-payload audit.
    rawBody: true,
    logger: false,
    bufferLogs: true,
  });

  // Nest forwards (message, stack, context) — the bridge previously kept only
  // the first argument, silently dropping error stacks and logger context.
  const fmtLog = (m: unknown, ...rest: unknown[]): string => {
    const extra = rest.filter((x) => x !== undefined && x !== null).map(String);
    return extra.length > 0 ? `${String(m)} | ${extra.join(" ")}` : String(m);
  };
  app.useLogger({
    log: (m: unknown, ...rest: unknown[]) => logger.info(fmtLog(m, ...rest)),
    error: (m: unknown, ...rest: unknown[]) => logger.error(fmtLog(m, ...rest)),
    warn: (m: unknown, ...rest: unknown[]) => logger.warn(fmtLog(m, ...rest)),
    debug: (m: unknown, ...rest: unknown[]) => logger.debug(fmtLog(m, ...rest)),
    verbose: (m: unknown, ...rest: unknown[]) => logger.trace(fmtLog(m, ...rest)),
  });

  // --- Security headers -----------------------------------------------------
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { "default-src": ["'none'"] } },
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  // --- CORS -----------------------------------------------------------------
  app.enableCors({
    origin: env.CORS_ORIGINS,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization", "x-api-key", "x-correlation-id", "idempotency-key"],
    credentials: true,
    maxAge: 600,
  });

  app.setGlobalPrefix("api");
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });

  // --- Body limits ----------------------------------------------------------
  app.useBodyParser("json", { limit: env.API_JSON_BODY_LIMIT });
  app.useBodyParser("urlencoded", { limit: env.API_JSON_BODY_LIMIT, extended: true });

  // --- Validation -----------------------------------------------------------
  // Zod (shared schemas) for DTOs; Nest ValidationPipe as a safety net for
  // anything that bypasses DTOs.
  app.useGlobalPipes(new ZodValidationPipe(), new ValidationPipe({ transform: true }));

  app.useGlobalFilters(new AllExceptionsFilter());
  app.getHttpAdapter().getInstance().disable("x-powered-by");

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal} — shutting down gracefully`);
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen(env.API_PORT, env.API_HOST);
  logger.info(`API listening on http://${env.API_HOST}:${env.API_PORT}/api/v1`);
}

void bootstrap().catch((err: unknown) => {
  // Bootstrap failures happen before the logger exists — print and exit.
  // NOTE: write synchronously — `console.error` + `process.exit()` can drop
  // the message when stderr is a pipe/file (Node buffers writes async).
  try {
    const msg = `Fatal bootstrap error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`;
    fs.writeSync(2, msg);
  } catch {
    // last resort — never mask the original error
  }
  process.exit(1);
});
