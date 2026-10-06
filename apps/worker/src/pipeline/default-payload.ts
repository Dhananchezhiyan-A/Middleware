import type { CanonicalLead } from "@middleware/types";

/**
 * Generic pass-through payload used when a destination has NO active field
 * mapping configured. It flattens the most common canonical fields into a
 * neutral shape — per-destination mappings (FieldMapping ACTIVE versions)
 * remain the recommended, fully configurable path.
 */
export function defaultMappedPayload(
  canonical: CanonicalLead,
  score?: number | null,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (canonical.email) payload.email = canonical.email;
  if (canonical.emailAlt) payload.emailAlt = canonical.emailAlt;
  if (canonical.phone) payload.phone = canonical.phone;
  if (canonical.phoneAlt) payload.phoneAlt = canonical.phoneAlt;
  if (canonical.name?.full) payload.name = canonical.name.full;
  if (canonical.name?.first) payload.firstName = canonical.name.first;
  if (canonical.name?.last) payload.lastName = canonical.name.last;
  if (canonical.company) payload.company = canonical.company;
  if (canonical.jobTitle) payload.jobTitle = canonical.jobTitle;
  if (canonical.project) payload.project = canonical.project;
  if (canonical.budget !== undefined) payload.budget = canonical.budget;
  if (canonical.currency) payload.currency = canonical.currency;

  const loc = canonical.location ?? {};
  if (loc.line1) payload.address = [loc.line1, loc.line2].filter(Boolean).join(", ");
  if (loc.city) payload.city = loc.city;
  if (loc.state) payload.state = loc.state;
  if (loc.country) payload.country = loc.country;
  if (loc.postalCode) payload.postalCode = loc.postalCode;

  if (canonical.sourceInfo?.campaign) payload.campaign = canonical.sourceInfo.campaign;
  if (canonical.sourceInfo?.pageUrl) payload.pageUrl = canonical.sourceInfo.pageUrl;
  if (canonical.consent?.status) payload.consentStatus = canonical.consent.status;
  if (score !== undefined && score !== null) payload.score = score;
  if (canonical.custom && Object.keys(canonical.custom).length > 0) {
    payload.custom = canonical.custom;
  }
  return payload;
}
