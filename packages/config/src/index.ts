import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

/**
 * Central, validated application configuration.
 *
 * - Loads `.env` from the workspace root (works from any app/package cwd).
 * - Validates ONCE with Zod — invalid configuration fails fast at startup,
 *   never at request time.
 * - Never logs secret values.
 */

function findRootEnv(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

let loaded = false;
function ensureDotenv(): void {
  if (loaded) return;
  loaded = true;
  const envPath = findRootEnv();
  if (envPath) loadDotenv({ path: envPath, quiet: true });
}

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : v === "true" || v === "1"));

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const csv = (def: string) =>
  z
    .string()
    .optional()
    .transform((v) =>
      (v ?? def)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  LOG_PRETTY: bool(false),

  // API
  API_PORT: int(4000, 1, 65535),
  API_HOST: z.string().default("0.0.0.0"),
  CORS_ORIGINS: csv("http://localhost:3000"),
  PUBLIC_API_BASE_URL: z.string().default("http://localhost:4000"),
  API_JSON_BODY_LIMIT: int(1_048_576, 1024),
  API_RATE_LIMIT_PER_MIN: int(300, 1),
  AUTH_RATE_LIMIT_PER_MIN: int(20, 1),
  WEBHOOK_RATE_LIMIT_PER_MIN: int(600, 1),

  // Web
  NEXT_PUBLIC_API_URL: z.string().default("http://localhost:4000"),

  // Database — required
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Redis — required (BullMQ)
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: int(6379, 1, 65535),
  REDIS_PASSWORD: z.string().optional().default(""),

  // Auth
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 chars"),
  JWT_ACCESS_TTL: int(900, 60),
  JWT_REFRESH_TTL: int(2_592_000, 300),
  JWT_ISSUER: z.string().default("lead-middleware"),

  // Secret encryption (AES-256-GCM): base64-encoded 32-byte key
  ENCRYPTION_KEY: z.string().min(1, "ENCRYPTION_KEY is required"),

  DEFAULT_WEBHOOK_SIGNING_SECRET: z.string().optional().default(""),

  // Queue
  LEAD_INTAKE_CONCURRENCY: int(5, 1),
  LEAD_PROCESSING_CONCURRENCY: int(5, 1),
  DELIVERY_CONCURRENCY: int(10, 1),
  CSV_IMPORT_CONCURRENCY: int(2, 1),
  DELIVERY_MAX_ATTEMPTS: int(5, 1, 20),
  DELIVERY_TIMEOUT_MS: int(15_000, 100),

  // Storage
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  S3_ENDPOINT: z.string().optional().default(""),
  S3_REGION: z.string().optional().default(""),
  S3_BUCKET: z.string().optional().default(""),
  S3_ACCESS_KEY_ID: z.string().optional().default(""),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(""),

  // Observability
  OTEL_ENABLED: bool(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional().default(""),
  SENTRY_DSN: z.string().optional().default(""),

  // Security toggles
  // Development convenience: allow custom-API destinations on localhost.
  SSRF_ALLOW_PRIVATE_HOSTS: z.string().optional().default(""),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  ensureDotenv();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Reset cached env — test use only. */
export function resetEnvCache(): void {
  cached = null;
  loaded = false;
}

// =============================================================================
// DATABASE SAFETY GUARD
// =============================================================================

/**
 * Databases this application is FORBIDDEN from ever touching, regardless of
 * environment. `dct_crm` is a separate production system (DCT CRM).
 */
const BLOCKED_DATABASES = new Set(["dct_crm", "postgres", "template0", "template1"]);

/** In development/test, only this database name may be used. */
const EXPECTED_DEV_DATABASE = "middleware";

export class UnsafeDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeDatabaseError";
  }
}

/**
 * Verifies a connection string points at an allowed database BEFORE any
 * Prisma/migration/CLI operation runs.
 *
 * Rules:
 *  1. The database name may never be in the blocked set (dct_crm, system DBs).
 *  2. In development/test the host must be loopback AND the database must be
 *     the dedicated `middleware` database.
 *  3. In production the database must exist explicitly (non-empty name).
 */
export function assertSafeDatabaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeDatabaseError("DATABASE_URL is not a valid connection URL");
  }

  const dbName = parsed.pathname.replace(/^\//, "").split("?")[0] ?? "";
  if (!dbName) {
    throw new UnsafeDatabaseError("DATABASE_URL must include a database name");
  }
  if (BLOCKED_DATABASES.has(dbName.toLowerCase())) {
    throw new UnsafeDatabaseError(
      `Refusing to use blocked database "${dbName}" — this application must never touch it.`,
    );
  }

  const env = getEnv();
  const isProd = env.NODE_ENV === "production";
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);

  if (!isProd) {
    if (!loopback) {
      throw new UnsafeDatabaseError(
        `Non-production DATABASE_URL must use loopback, got host "${parsed.hostname}"`,
      );
    }
    if (dbName !== EXPECTED_DEV_DATABASE) {
      throw new UnsafeDatabaseError(
        `Non-production DATABASE_URL must point at the dedicated "${EXPECTED_DEV_DATABASE}" database, got "${dbName}". ` +
          `Refusing to run against an unknown database.`,
      );
    }
  }
}
