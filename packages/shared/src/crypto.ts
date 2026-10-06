import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Cryptographic helpers.
 *
 * Rules:
 *  - Secrets at rest are AES-256-GCM ciphertext (never plaintext columns).
 *  - Tokens/API keys are stored only as SHA-256 hashes.
 *  - Comparison of hashes/signatures uses timing-safe equality.
 *  - Keys come from ENCRYPTION_KEY (env / secrets manager) — never hardcoded.
 */

const ENC_VERSION = "v1";

let cachedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ENCRYPTION_KEY is not set — cannot encrypt/decrypt secrets.");
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error("ENCRYPTION_KEY is not valid base64.");
  }
  if (key.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}).`);
  }
  cachedKey = key;
  return key;
}

/** Test helper: clear the cached key (e.g. after rotating env in tests). */
export function resetEncryptionKeyCache(): void {
  cachedKey = null;
}

/** AES-256-GCM. Output: `v1.<iv>.<tag>.<ciphertext>` (base64url). */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENC_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ct.toString("base64url"),
  ].join(".");
}

export function decryptSecret(encoded: string): string {
  const parts = encoded.split(".");
  const ivB64 = parts.at(1);
  const tagB64 = parts.at(2);
  const ctB64 = parts.at(3);
  if (
    parts.length !== 4 ||
    parts[0] !== ENC_VERSION ||
    ivB64 === undefined ||
    tagB64 === undefined ||
    ctB64 === undefined
  ) {
    throw new Error("Malformed encrypted secret payload.");
  }
  const key = getEncryptionKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Timing-safe comparison of two hex/base64url strings of equal length. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against self to keep timing uniform on mismatch.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** URL-safe random token (API keys, refresh tokens, webhook secrets). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** One-way hash for bearer-style tokens (refresh tokens, API keys). */
export function hashToken(token: string): string {
  return sha256Hex(token);
}
