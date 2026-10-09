import { ROUTING_FALLBACK_LABEL, ROUTING_FALLBACK_TYPE } from "@middleware/types";

/**
 * The routing fallback is INTERNAL: "middleware" is this application itself, so
 * an unmatched lead is simply kept where it already is — no Destination row, no
 * delivery, no outbound request.
 *
 * This module turns the stored `RoutingResult.reason` (and the preview's
 * `reason`) into copy the UI can render, so no component re-implements the
 * detection rules.
 */

/**
 * Legacy wording written before the marker existed for the SAME outcome
 * ("no rule matched, nothing deliverable, lead retained"). Kept in sync with
 * the analytics query so the dashboard and the lead panel always agree.
 */
const LEGACY_NO_MATCH_REASON = "no routing rule matched";

/** Normalise a stored reason for inspection. */
function normalize(reason: string | null | undefined): string {
  return (reason ?? "").trim();
}

/** True when the reason records the internal Middleware fallback. */
export function isInternalMiddlewareFallback(reason: string | null | undefined): boolean {
  const text = normalize(reason);
  return text.includes(ROUTING_FALLBACK_TYPE) || text.toLowerCase() === LEGACY_NO_MATCH_REASON;
}

export interface RoutingFallbackInfo {
  /** true when this decision is the internal fallback (no external delivery). */
  active: boolean;
  /** true when a rule DID match but none of its destinations were usable. */
  ruleMatched: boolean;
  /** "Internal Middleware" — the label shown wherever fallback appears. */
  label: string;
  /** Short heading, e.g. "Fallback: Internal Middleware". */
  heading: string;
  /** Headline for the lead-details routing panel. */
  title: string;
  /** Supporting sentence for the lead-details routing panel. */
  description: string;
}

const INACTIVE: RoutingFallbackInfo = {
  active: false,
  ruleMatched: false,
  label: ROUTING_FALLBACK_LABEL,
  heading: "",
  title: "",
  description: "",
};

/**
 * Explains a routing decision for display.
 *
 * Distinguishes the two fallback cases the business rules care about:
 *  - no rule matched, and
 *  - a rule matched but every selected destination was disabled/invalid.
 */
export function routingFallbackInfo(reason: string | null | undefined): RoutingFallbackInfo {
  const text = normalize(reason);
  if (!isInternalMiddlewareFallback(reason)) return INACTIVE;

  const ruleMatched = /^Rule matched/i.test(text);
  return {
    active: true,
    ruleMatched,
    label: ROUTING_FALLBACK_LABEL,
    heading: `Fallback: ${ROUTING_FALLBACK_LABEL}`,
    title: ruleMatched
      ? "Rule matched, but no valid external destination was available."
      : "No external destination matched.",
    description: "The lead remains in Middleware.",
  };
}
