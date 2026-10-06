import { getEnv } from "@middleware/config";

/**
 * Loads `.env` (via the validated config loader) BEFORE any test file calls
 * `getPrisma()`. `getPrisma()` reads `process.env.DATABASE_URL` directly, and
 * dotenv is only applied lazily inside `getEnv()` — without this file every
 * DB-backed test would see an empty DATABASE_URL and fail the safety guard.
 */
getEnv();
