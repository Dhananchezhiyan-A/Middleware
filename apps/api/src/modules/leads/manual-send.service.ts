import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { getEnv } from "@middleware/config";
import type { Database } from "@middleware/database";
import { applyFieldMapping, defaultMappedPayload } from "@middleware/integrations";
import { errors } from "@middleware/shared";
import type { CanonicalLead, FieldMappingField, RequestActor } from "@middleware/types";
import { AuditService } from "../../infra/audit.module";
import { PRISMA } from "../../infra/prisma.module";
import { QueuesService } from "../../infra/redis.module";
import { LeadSelectionStore, isSelectionToken } from "../../infra/selection.store";
import { buildLeadFilterWhere, type LeadFilterQuery } from "./lead-filters";

/**
 * Manual "Send Selected Leads to CRM" — selection snapshots, preview and the
 * bounded, audited send.
 *
 * Reuses the existing delivery architecture end to end:
 *  - delivery rows are created with the SAME semantics as the routing fan-out
 *    (active field-mapping snapshot, fail-fast on missing required fields,
 *    exactly one row per lead×destination — the DB unique constraint is the
 *    last line of defence against duplicates),
 *  - actual delivery stays in the worker (`deliver` job → DeliveryService →
 *    adapter) with all its rate limits, retries and audit trails,
 *  - `enqueueDelivery` uses a deterministic jobId, so repeated clicks or
 *    network retries can never enqueue the same delivery twice.
 *
 * The browser is never trusted: lead IDs, destination eligibility, limits and
 * selection ownership are all revalidated here before anything is written.
 */

export type SelectionMode = "page" | "filtered";

export interface ManualSendBody {
  selectionToken?: string;
  leadIds?: string[];
  destinationIds: string[];
}

export interface SelectionInfo {
  mode: SelectionMode;
  filters: Record<string, unknown> | null;
}

export interface LeadSelectionResult extends SelectionInfo {
  token: string;
  count: number;
  expiresAt: string;
}

export interface ManualSendPreview extends SelectionInfo {
  leadCount: number;
  missingLeads: number;
  destinations: Array<{ id: string; name: string; type: string; status: string }>;
  combinations: number;
  eligible: number;
  skippedExisting: number;
  skippedMissingLeads: number;
  limits: { maxLeads: number; maxCombinations: number };
}

export interface ManualSendResult extends SelectionInfo {
  submissionId: string;
  leadCount: number;
  missingLeads: number;
  destinations: Array<{ id: string; name: string; type: string }>;
  combinations: number;
  /** New deliveries queued for the worker. */
  created: number;
  /** Existing deliveries (any status) + leads that no longer exist. */
  skipped: number;
  skippedExisting: number;
  skippedMissingLeads: number;
  /** Pairs rejected before any external call because the mapping misses required fields. */
  failed: number;
  /** Queued rows whose enqueue failed — the worker sweeper recovers them. */
  enqueueFailures: number;
  createdAt: string;
}

interface ResolvedSelection extends SelectionInfo {
  ids: string[];
  token?: string;
}

interface LeadRow {
  id: string;
  canonicalData: unknown;
  score: number | null;
}

interface MappingInfo {
  fields: FieldMappingField[] | null;
  name: string | null;
}

type PairOutcome =
  | { kind: "created"; deliveryId: string }
  | { kind: "skipped"; status: string }
  | { kind: "missing" }
  | { kind: "mappingRejected" };

const LEAD_LOAD_CHUNK = 1_000;
const PAIR_BATCH = 50;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

@Injectable()
export class ManualSendService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Database,
    private readonly audit: AuditService,
    private readonly queues: QueuesService,
    private readonly selections: LeadSelectionStore,
  ) {}

  // ===========================================================================
  // Selection (server-side snapshot of every lead matching the filters)
  // ===========================================================================

  async createSelection(
    _actor: RequestActor,
    filters: LeadFilterQuery,
  ): Promise<LeadSelectionResult> {
    const max = getEnv().LEAD_SELECTION_MAX;
    const where = buildLeadFilterWhere(filters);
    // max + 1 → detect "too many" without counting twice.
    const rows = await this.prisma.lead.findMany({
      where: where as never,
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      select: { id: true },
      take: max + 1,
    });
    if (rows.length === 0) {
      throw errors.badRequest("No leads match the current filters — nothing to select.");
    }
    if (rows.length > max) {
      throw errors.payloadTooLarge(
        `This selection matches more than ${max} leads, the configured maximum. Narrow your filters before selecting all filtered leads.`,
      );
    }
    const { token, expiresAt } = await this.selections.create({
      actorId: _actor.userId,
      mode: "filtered",
      ids: rows.map((r) => r.id),
      filters: filters as Record<string, unknown>,
    });
    return { token, count: rows.length, expiresAt, mode: "filtered", filters: filters as Record<string, unknown> };
  }

  // ===========================================================================
  // Preview (authoritative counts for the confirmation dialog)
  // ===========================================================================

  async preview(actor: RequestActor, body: ManualSendBody): Promise<ManualSendPreview> {
    const selection = await this.resolveSelection(actor, body);
    const destinations = await this.loadDestinations(body.destinationIds);
    this.assertCombinationLimit(selection.ids.length, destinations.length);

    const existing = await this.findExistingPairs(selection.ids, destinations.map((d) => d.id));
    const present = await this.countPresentLeads(selection.ids);
    const missingLeads = selection.ids.length - present;
    const combinations = selection.ids.length * destinations.length;
    const skippedMissingLeads = missingLeads * destinations.length;

    return {
      mode: selection.mode,
      filters: selection.filters,
      leadCount: selection.ids.length,
      missingLeads,
      destinations,
      combinations,
      eligible: present * destinations.length - existing.size,
      skippedExisting: existing.size,
      skippedMissingLeads,
      limits: {
        maxLeads: getEnv().LEAD_SELECTION_MAX,
        maxCombinations: getEnv().MANUAL_SEND_MAX_DELIVERIES,
      },
    };
  }

  // ===========================================================================
  // Send (bounded batches; every ID revalidated before the first write)
  // ===========================================================================

  async send(actor: RequestActor, body: ManualSendBody): Promise<ManualSendResult> {
    const env = getEnv();
    const selection = await this.resolveSelection(actor, body);
    const destinations = await this.loadDestinations(body.destinationIds);
    const destinationIds = destinations.map((d) => d.id);
    this.assertCombinationLimit(selection.ids.length, destinationIds.length);

    const leads = await this.loadLeads(selection.ids);
    const missingLeads = selection.ids.length - leads.size;
    const existing = await this.findExistingPairs(selection.ids, destinationIds);
    const mappings = await this.loadMappings(destinationIds);

    const submissionId = randomUUID();
    let created = 0;
    let skippedExisting = 0;
    let skippedMissingLeads = 0;
    let mappingRejected = 0;
    let enqueueFailures = 0;

    // Bounded batches: at most PAIR_BATCH pairs are in flight at once.
    const pairs: Array<{ leadId: string; destinationId: string }> = [];
    for (const leadId of selection.ids) {
      for (const destinationId of destinationIds) pairs.push({ leadId, destinationId });
    }

    for (const batch of chunks(pairs, PAIR_BATCH)) {
      const outcomes = await Promise.all(
        batch.map((pair) => this.createPair(pair, leads, existing, mappings, submissionId, env.DELIVERY_MAX_ATTEMPTS)),
      );
      const toEnqueue: Array<{ deliveryId: string; leadId: string; destinationId: string }> = [];
      outcomes.forEach((outcome, index) => {
        const pair = batch[index];
        switch (outcome.kind) {
          case "created":
            created += 1;
            toEnqueue.push({ deliveryId: outcome.deliveryId, ...pair });
            break;
          case "skipped":
            skippedExisting += 1;
            break;
          case "missing":
            skippedMissingLeads += 1;
            break;
          case "mappingRejected":
            mappingRejected += 1;
            break;
        }
      });
      await Promise.all(
        toEnqueue.map(async (job) => {
          try {
            await this.queues.enqueueDelivery({ ...job, correlationId: submissionId });
          } catch {
            // The row is QUEUED with enqueuedAt set; the worker sweeper
            // re-enqueues lost jobs. Reported honestly below.
            enqueueFailures += 1;
          }
        }),
      );
    }

    // The token is consumed only after the run, so a failed request (e.g. a
    // queue outage) can be retried with the same selection.
    if (selection.token) await this.selections.delete(selection.token);

    const result: ManualSendResult = {
      submissionId,
      mode: selection.mode,
      filters: selection.filters,
      leadCount: selection.ids.length,
      missingLeads,
      destinations: destinations.map(({ id, name, type }) => ({ id, name, type })),
      combinations: selection.ids.length * destinationIds.length,
      created,
      skipped: skippedExisting + skippedMissingLeads,
      skippedExisting,
      skippedMissingLeads,
      failed: mappingRejected,
      enqueueFailures,
      createdAt: new Date().toISOString(),
    };

    await this.audit.record({
      action: "delivery.manual_send",
      entityType: "Delivery",
      entityId: submissionId,
      actorId: actor.userId,
      actorLabel: actor.email || null,
      actorType: actor.actorType,
      metadata: {
        mode: result.mode,
        leadCount: result.leadCount,
        destinationIds,
        combinations: result.combinations,
        created: result.created,
        skippedExisting: result.skippedExisting,
        skippedMissingLeads: result.skippedMissingLeads,
        failed: result.failed,
        enqueueFailures: result.enqueueFailures,
        filters: result.filters ?? undefined,
      },
    });

    return result;
  }

  // ===========================================================================

  /**
   * Resolves the leads to send: an expiring server-side snapshot token, or an
   * explicit ID list — never "no IDs means everything".
   */
  private async resolveSelection(actor: RequestActor, body: ManualSendBody): Promise<ResolvedSelection> {
    if (body.selectionToken) {
      if (!isSelectionToken(body.selectionToken)) {
        throw errors.badRequest("Invalid selection token.");
      }
      const record = await this.selections.get(body.selectionToken);
      if (!record) {
        throw errors.conflict(
          "This selection has expired or was already sent. Please select leads again.",
        );
      }
      if (record.actorId !== actor.userId) {
        throw errors.forbidden("This selection belongs to a different session.");
      }
      return {
        ids: record.ids,
        mode: record.mode,
        filters: record.filters ?? null,
        token: body.selectionToken,
      };
    }

    const ids = [...new Set(body.leadIds ?? [])];
    if (ids.length === 0) {
      throw errors.badRequest("No leads are selected. Select at least one lead before sending.");
    }
    const max = getEnv().LEAD_SELECTION_MAX;
    if (ids.length > max) {
      throw errors.payloadTooLarge(
        `Selecting ${ids.length} leads exceeds the configured maximum of ${max}. Use "Select all filtered leads" with narrower filters.`,
      );
    }
    return { ids, mode: "page", filters: null };
  }

  /** Every destination must exist AND be active — rejected before any write. */
  private async loadDestinations(
    destinationIds: string[],
  ): Promise<Array<{ id: string; name: string; type: string; status: string }>> {
    const unique = [...new Set(destinationIds)];
    const rows = await this.prisma.destination.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true, type: true, status: true },
    });
    const found = new Set(rows.map((r) => r.id));
    const missing = unique.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw errors.validation(`Destinations not found: ${missing.join(", ")}.`);
    }
    const inactive = rows.filter((r) => r.status !== "ACTIVE");
    if (inactive.length > 0) {
      throw errors.validation(
        `These destinations are not active and cannot receive leads: ${inactive.map((r) => r.name).join(", ")}.`,
      );
    }
    return rows;
  }

  private assertCombinationLimit(leadCount: number, destinationCount: number): void {
    const max = getEnv().MANUAL_SEND_MAX_DELIVERIES;
    const combinations = leadCount * destinationCount;
    if (combinations > max) {
      throw errors.payloadTooLarge(
        `This send would create ${combinations} lead-destination deliveries; the configured maximum is ${max}. Select fewer leads or destinations.`,
      );
    }
  }

  private async countPresentLeads(ids: string[]): Promise<number> {
    let present = 0;
    for (const batch of chunks(ids, LEAD_LOAD_CHUNK)) {
      const count = await this.prisma.lead.count({ where: { id: { in: batch } } });
      present += count;
    }
    return present;
  }

  private async loadLeads(ids: string[]): Promise<Map<string, LeadRow>> {
    const out = new Map<string, LeadRow>();
    for (const batch of chunks(ids, LEAD_LOAD_CHUNK)) {
      const rows = await this.prisma.lead.findMany({
        where: { id: { in: batch } },
        select: { id: true, canonicalData: true, score: true },
      });
      for (const row of rows) out.set(row.id, row);
    }
    return out;
  }

  /** Existing delivery rows for the requested pairs, keyed `leadId:destinationId`. */
  private async findExistingPairs(
    ids: string[],
    destinationIds: string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const batch of chunks(ids, LEAD_LOAD_CHUNK)) {
      const rows = await this.prisma.delivery.findMany({
        where: { leadId: { in: batch }, destinationId: { in: destinationIds } },
        select: { leadId: true, destinationId: true, status: true },
      });
      for (const row of rows) out.set(`${row.leadId}:${row.destinationId}`, row.status);
    }
    return out;
  }

  /** Active field mappings per destination (same rule as the routing fan-out). */
  private async loadMappings(destinationIds: string[]): Promise<Map<string, MappingInfo>> {
    const out = new Map<string, MappingInfo>();
    const rows = await this.prisma.fieldMapping.findMany({
      where: {
        destinationId: { in: destinationIds },
        status: "ACTIVE",
        activeVersionId: { not: null },
      },
      include: { versions: true },
    });
    for (const row of rows) {
      if (!row.activeVersionId) {
        out.set(row.destinationId, { fields: null, name: row.name });
        continue;
      }
      const version = row.versions.find((v) => v.id === row.activeVersionId);
      const raw: unknown = version ? (version.fields as unknown) : null;
      const fields: FieldMappingField[] = [];
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (!item || typeof item !== "object") continue;
          const obj = item as Record<string, unknown>;
          if (typeof obj.source !== "string" || typeof obj.target !== "string") continue;
          fields.push(obj as unknown as FieldMappingField);
        }
      }
      out.set(row.destinationId, {
        fields: fields.length > 0 ? fields : null,
        name: row.name,
      });
    }
    return out;
  }

  private async createPair(
    pair: { leadId: string; destinationId: string },
    leads: Map<string, LeadRow>,
    existing: Map<string, string>,
    mappings: Map<string, MappingInfo>,
    submissionId: string,
    maxAttempts: number,
  ): Promise<PairOutcome> {
    const { leadId, destinationId } = pair;
    const existingStatus = existing.get(`${leadId}:${destinationId}`);
    if (existingStatus) return { kind: "skipped", status: existingStatus };

    const lead = leads.get(leadId);
    if (!lead) return { kind: "missing" };

    const canonical = (lead.canonicalData ?? {}) as CanonicalLead;
    const mapping = mappings.get(destinationId) ?? { fields: null, name: null };
    const mappingCtx = {
      lead: canonical,
      ...(lead.score !== null ? { score: lead.score } : {}),
    };
    const outcome = mapping.fields
      ? applyFieldMapping(mapping.fields, mappingCtx)
      : {
          data: defaultMappedPayload(canonical, lead.score),
          missingRequired: [] as string[],
          appliedCount: 0,
        };

    try {
      if (outcome.missingRequired.length > 0) {
        // Fail fast WITHOUT an external call — same as the routing fan-out.
        const delivery = await this.prisma.delivery.create({
          data: {
            leadId,
            destinationId,
            status: "FAILED",
            attemptCount: 1,
            mappedPayload: outcome.data as never,
            correlationId: submissionId,
            completedAt: new Date(),
            errorCode: "DESTINATION_REJECTED",
            errorMessage: `Required fields missing in mapping: ${outcome.missingRequired.join(", ")}`,
          },
        });
        await this.prisma.deliveryAttempt.create({
          data: {
            deliveryId: delivery.id,
            attemptNumber: 1,
            status: "REJECTED",
            errorCode: "DESTINATION_REJECTED",
            errorCategory: "MAPPING",
            responseBody: null,
            durationMs: 0,
            requestMeta: {
              mapping: mapping.name ?? "default",
              missingRequired: outcome.missingRequired,
            } as never,
            finishedAt: new Date(),
            workerId: "api-manual-send",
          },
        });
        return { kind: "mappingRejected" };
      }

      const delivery = await this.prisma.delivery.create({
        data: {
          leadId,
          destinationId,
          status: "QUEUED",
          maxAttempts,
          mappedPayload: outcome.data as never,
          correlationId: submissionId,
          enqueuedAt: new Date(),
        },
      });
      // Make the pair "existing" for the rest of this run (duplicate rows are
      // impossible anyway — the unique constraint would raise P2002).
      existing.set(`${leadId}:${destinationId}`, "QUEUED");
      return { kind: "created", deliveryId: delivery.id };
    } catch (err) {
      // Concurrent duplicate submission → the unique (leadId, destinationId)
      // constraint already protects us: count it as skipped, never fail the run.
      if ((err as { code?: string }).code === "P2002") return { kind: "skipped", status: "EXISTING" };
      throw err;
    }
  }
}
