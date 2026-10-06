/**
 * Generates a ready-to-use local development .env from .env.example.
 *
 * - Copies .env.example
 * - Injects the known local PostgreSQL password (URL-encoded) for the
 *   dedicated `middleware` database ONLY.
 * - Generates cryptographically random secrets for JWT + AES encryption.
 *
 * Usage: node scripts/gen-dev-env.mjs [--force]
 * Refuses to overwrite an existing .env unless --force is passed.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');
const force = process.argv.includes('--force');

if (existsSync(envPath) && !force) {
  console.log('.env already exists — refusing to overwrite (pass --force to regenerate).');
  process.exit(0);
}

let content = readFileSync(examplePath, 'utf8');

// Local development PostgreSQL password must be provided via environment
// (percent-encoded for URL safety). It is NEVER stored in source files.
const localPgPassword = process.env.LOCAL_PG_PASSWORD;
if (!localPgPassword) {
  console.error(
    'LOCAL_PG_PASSWORD env var is required (URL-encoded form, e.g. pass%40word). Aborting.',
  );
  process.exit(1);
}
content = content.replace(
  'DATABASE_URL=postgresql://postgres:REPLACE_ME@localhost:5432/middleware',
  `DATABASE_URL=postgresql://postgres:${localPgPassword}@localhost:5432/middleware`,
);

content = content.replace(
  'JWT_ACCESS_SECRET=REPLACE_ME',
  `JWT_ACCESS_SECRET=${randomBytes(48).toString('base64url')}`,
);
content = content.replace(
  'ENCRYPTION_KEY=REPLACE_ME',
  `ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
);
content = content.replace(
  'DEFAULT_WEBHOOK_SIGNING_SECRET=REPLACE_ME',
  `DEFAULT_WEBHOOK_SIGNING_SECRET=${randomBytes(32).toString('hex')}`,
);

writeFileSync(envPath, content, 'utf8');
console.log('Wrote .env with generated development secrets (gitignored).');
