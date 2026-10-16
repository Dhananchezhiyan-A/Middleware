import { hmacSha256Hex } from "@middleware/shared";
import { getEnv } from "@middleware/config";
import type { CanonicalLead } from "@middleware/types";

/**
 * VALIDATION and NORMALIZATION stages — pure functions, unit-tested without
 * Redis or PostgreSQL.
 *
 * Normalization produces the canonical data every later stage reads, plus the
 * application-keyed dedup hashes stored on the Lead row (never raw PII in index
 * columns).
 *
 * The VALIDATION rule set itself lives in `@middleware/validation`
 * (`validateCanonical`) so the CSV upload UI validates rows with EXACTLY the
 * rules this pipeline applies — import the helper from there.
 */

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

function lower(v: string | undefined): string | undefined {
  return v === undefined ? undefined : v.toLowerCase();
}

/** Strips everything but digits and a single leading + for dedup matching. */
export function normalizePhone(raw: string | undefined): string | undefined {
  const v = str(raw);
  if (v === undefined) return undefined;
  const hasPlus = v.includes("+");
  const digits = v.replace(/\D/g, "");
  if (digits === "") return undefined;
  return hasPlus ? `+${digits}` : digits;
}

/**
 * Domain-separated HMAC keeps dedup fingerprints stable within this application
 * without exposing raw contact values in indexed columns.
 */
export function dedupHash(value: string): string {
  return hmacSha256Hex(`dedup:v1:${getEnv().ENCRYPTION_KEY}`, value);
}

export interface NormalizationOutcome {
  canonical: CanonicalLead;
  dedupEmailHash?: string;
  dedupPhoneHash?: string;
}

/** Normalizes a canonical lead in place-safe fashion (returns a new object). */
export function normalizeCanonical(
  canonical: CanonicalLead,
): NormalizationOutcome {
  const next: CanonicalLead = { ...canonical };

  next.email = lower(str(canonical.email));
  next.emailAlt = lower(str(canonical.emailAlt));
  next.phone = normalizePhone(canonical.phone);
  next.phoneAlt = normalizePhone(canonical.phoneAlt);
  next.company = str(canonical.company);
  next.jobTitle = str(canonical.jobTitle);
  next.project = str(canonical.project);
  next.currency = canonical.currency ? str(canonical.currency)?.toUpperCase() : undefined;

  // Name: fill `full` from first/last, or split `full` when parts are absent.
  const name = { ...(canonical.name ?? {}) };
  const first = str(name.first);
  const last = str(name.last);
  const full = str(name.full);
  if (first !== undefined) name.first = first;
  if (last !== undefined) name.last = last;
  if (full !== undefined) {
    name.full = full;
    if (first === undefined && last === undefined) {
      const parts = full.split(/\s+/);
      name.first = parts[0];
      if (parts.length > 1) name.last = parts.slice(1).join(" ");
    }
  } else if (first !== undefined || last !== undefined) {
    name.full = [first, last].filter(Boolean).join(" ");
  }
  if (name.first !== undefined || name.last !== undefined || name.full !== undefined) {
    next.name = name;
  }

  if (canonical.location) {
    const loc: Record<string, string> = {};
    for (const [k, v] of Object.entries(canonical.location)) {
      const s = str(v);
      if (s !== undefined) loc[k] = s;
    }
    next.location = loc as CanonicalLead["location"];
  }

  const outcome: NormalizationOutcome = { canonical: next };
  if (next.email) outcome.dedupEmailHash = dedupHash(next.email);
  if (next.phone) outcome.dedupPhoneHash = dedupHash(next.phone);
  return outcome;
}
