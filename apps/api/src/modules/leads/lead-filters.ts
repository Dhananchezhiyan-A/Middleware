import { getEnv } from "@middleware/config";
import { assertReceivedRangeValid, resolveReceivedRange } from "@middleware/validation";
import { errors } from "@middleware/shared";

/**
 * The one where-clause builder for leads.
 *
 * `GET /leads`, the server-side selection endpoint and manual-send preview all
 * resolve criteria through this function, so "what the list shows" and "what a
 * selection covers" can never drift apart.
 *
 * receivedAt ranges come in two flavours, never both at once:
 *  - legacy `from`/`to` ISO instants (dashboard drill-ins), or
 *  - calendar date/time/quick-range fields resolved HERE in APP_TIMEZONE.
 */
export interface LeadFilterQuery {
  status?: string;
  sourceId?: string;
  destinationId?: string;
  scoreMin?: number;
  q?: string;
  from?: string;
  to?: string;
  dateFrom?: string;
  dateTo?: string;
  timeFrom?: string;
  timeTo?: string;
  quickRange?: string;
}

/** 422 with every detected range problem (formats are already zod-checked). */
function assertRangeValid(query: LeadFilterQuery): void {
  try {
    assertReceivedRangeValid(query);
  } catch (err) {
    throw errors.validation((err as Error).message);
  }
}

export function buildLeadFilterWhere(query: LeadFilterQuery): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (query.status) where["status"] = query.status;
  if (query.sourceId) where["sourceId"] = query.sourceId;
  if (query.scoreMin !== undefined) where["score"] = { gte: query.scoreMin };

  const hasNewRange = Boolean(
    query.dateFrom || query.dateTo || query.timeFrom || query.timeTo || query.quickRange,
  );
  if (hasNewRange) {
    assertRangeValid(query);
    const resolved = resolveReceivedRange(query, getEnv().APP_TIMEZONE);
    const range: Record<string, Date> = {};
    if (resolved.gte) range["gte"] = resolved.gte;
    if (resolved.lte) range["lte"] = resolved.lte;
    if (Object.keys(range).length > 0) where["receivedAt"] = range;
  } else {
    const range: Record<string, Date> = {};
    if (query.from) range["gte"] = new Date(query.from);
    if (query.to) range["lte"] = new Date(query.to);
    if (Object.keys(range).length > 0) where["receivedAt"] = range;
  }

  if (query.destinationId) {
    where["deliveries"] = { some: { destinationId: query.destinationId } };
  }
  if (query.q) {
    const q = query.q.trim();
    const asEmail = q.toLowerCase();
    const asPhone = q.replace(/\D/g, "");
    where["OR"] = [
      { id: { contains: q } },
      { leadId: q },
      { canonicalData: { path: ["name", "full"], string_contains: q, mode: "insensitive" } },
      { canonicalData: { path: ["name", "first"], string_contains: q, mode: "insensitive" } },
      { canonicalData: { path: ["name", "last"], string_contains: q, mode: "insensitive" } },
      { canonicalData: { path: ["email"], equals: asEmail } },
      ...(asPhone.length >= 6 ? [{ canonicalData: { path: ["phone"], equals: q } }] : []),
      { externalLeadId: q },
    ];
  }

  return where;
}
