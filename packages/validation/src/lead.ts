/**
 * Canonical lead validation — the single rule set every entry point uses:
 * the worker VALIDATION stage AND the CSV upload preview in the browser.
 *
 * Keeping it here (rather than in an app) means the rows the user is shown
 * "will fail" are exactly the rows the import will report as failed.
 *
 * Pure function: no I/O, no environment, no database.
 */

import type { CanonicalLead } from "@middleware/types";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Loose international phone: optional +, 7–15 digits after separators. */
const PHONE_RE = /^\+?[\d\s\-().]{7,25}$/;

export function validateCanonical(canonical: CanonicalLead): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const email =
    typeof canonical.email === "string" && canonical.email.trim() !== "" ? canonical.email : undefined;
  const phone =
    typeof canonical.phone === "string" && canonical.phone.trim() !== "" ? canonical.phone : undefined;

  if (email === undefined && phone === undefined) {
    errors.push("Lead must contain at least one contact channel (email or phone).");
  }
  if (email !== undefined && !EMAIL_RE.test(email.trim())) {
    errors.push("Email address is not in a valid format.");
  }
  if (canonical.emailAlt && !EMAIL_RE.test(canonical.emailAlt.trim())) {
    warnings.push("Alternate email address looks invalid and will be kept verbatim.");
  }
  if (phone !== undefined && !PHONE_RE.test(phone.trim())) {
    errors.push("Phone number is not in a valid format.");
  }
  if (canonical.budget !== undefined && canonical.budget !== null) {
    if (typeof canonical.budget !== "number" || Number.isNaN(canonical.budget)) {
      errors.push("Budget must be numeric.");
    } else if (canonical.budget < 0) {
      errors.push("Budget cannot be negative.");
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
