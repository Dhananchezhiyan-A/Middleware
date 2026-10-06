import { pino, type Logger, type LoggerOptions as PinoLoggerOptions } from "pino";
import { getCorrelationId } from "./correlation";

/**
 * Structured logging (Pino).
 *
 * - JSON logs by default; optional pretty output in development.
 * - Credential-shaped fields are redacted by pino itself (belt) ON TOP of
 *   application-level sanitizeDeep() (suspenders).
 * - Logger carries the ambient correlationId so every line is traceable.
 */

const REDACT_PATHS = [
  "password",
  "passwordHash",
  "secret",
  "token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "api_key",
  "keyHash",
  "encryptionKey",
  "authorization",
  "cookie",
  "*.password",
  "*.passwordHash",
  "*.secret",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.apiKey",
  "*.keyHash",
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-api-key']",
  "res.headers['set-cookie']",
  "headers.authorization",
  "headers.cookie",
];

export interface LoggerOptions {
  name?: string;
  level?: string;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? process.env.LOG_LEVEL ?? "info";
  const base: PinoLoggerOptions = {
    level,
    base: { service: options.name ?? "middleware" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  if (process.env.LOG_PRETTY === "true") {
    try {
      return pino({
        ...base,
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname,service" },
        },
      });
    } catch {
      // pino-pretty not installed — fall through to JSON logging.
    }
  }
  return pino(base);
}

let rootLogger: Logger | null = null;

export function getLogger(): Logger {
  if (!rootLogger) rootLogger = createLogger();
  return rootLogger;
}

/** Child logger bound to the ambient correlation context. */
export function getContextLogger(): Logger {
  const ctx = { correlationId: getCorrelationId() };
  return getLogger().child(ctx);
}
