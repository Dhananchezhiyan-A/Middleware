import { UnrecoverableError } from "bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { getEnv } from "@middleware/config";
import { getPrisma, type Prisma } from "@middleware/database";
import { hmacSha256Hex } from "@middleware/shared";
import {
  applyFieldMapping,
  type MappingContext,
} from "@middleware/integrations";
import type {
  CanonicalLead,
  FieldMappingField,
  LeadStage,
} from "@middleware/types";
import { QueueProducer } from "../queues/queue-producer";
import { json, fromJson } from "../common/json";
import { recordStage, withStage } from "./stage-events";
import {
  dedupHash,
  normalizeCanonical,
  validateCanonical,
} from "./validate-normalize";
import {
  evaluateConditions,
  evaluateRouting,
  type ConditionContext,
  type RoutingFallback,
  type RoutingRuleInput,
} from "./conditions";
import { defaultMappedPayload } from "./default-payload";

/**
 * The lead processing pipeline: VALIDATION → NORMALIZATION → DEDUPLICATION →
 * ENRICHMENT → SCORING → ROUTING → MAPPING → QUEUED.
 *
 * Design rules:
 *  - Every stage records an immutable LeadStageEvent (PASSED/FAILED/SKIPPED).
 *  - Stages are idempotent: a retried job re-runs them without corrupting
 *    state (append-only history, unique upserts, delivery identity).
 *  - Business failures (invalid lead, duplicate) are NOT job failures: the
 *    job completes and the lead is terminally marked. Only infrastructure
 *    errors are thrown so BullMQ retries them with backoff.
 *  - Skipped/not-implemented work is reported honestly as SKIPPED with a
 *    reason — never a fake success.
 */

type LeadRow = Prisma.LeadGetPayload<{ include: { source: true; sourceAccount: true } }>;

export interface PipelineResult {
  outcome: "distributed" | "no-destination" | "duplicate" | "rejected";
  deliveries: number;
}

interface StageContext {
  leadId: string;
  correlationId: string;
  lead: LeadRow;
  canonical: CanonicalLead;
  score: number | null;
}

/** Result of the ROUTING stage: where the lead must be delivered. */
interface RoutingOutcome {
  /** Unique EXTERNAL destination ids — one delivery record each. */
  destinationIds: string[];
  /** Human-readable decision stored on RoutingResult.reason. */
  reason: string;
  matched: boolean;
  /** true when the lead stays inside Middleware (no external delivery). */
  usedFallback: boolean;
  /** Internal fallback decision — null when the lead is routed externally. */
  fallback: RoutingFallback | null;
}

const TERMINAL_DELIVERY_STATUSES = new Set(["SUCCEEDED", "FAILED", "DEAD", "SKIPPED"]);

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(private readonly queues: QueueProducer) {}

  // ===========================================================================
  // Full pipeline
  // ===========================================================================

  async processLead(job: {
    leadId: string;
    correlationId: string;
  }): Promise<PipelineResult> {
    const db = getPrisma();
    const { leadId, correlationId } = job;

    const lead = await db.lead.findFirst({
      where: { id: leadId },
      include: { source: true, sourceAccount: true },
    });
    if (!lead) {
      // Permanent: retrying can never materialize a missing lead.
      throw new UnrecoverableError(`Lead ${leadId} not found`);
    }

    await db.leadProcessing.upsert({
      where: { leadId },
      create: { leadId, correlationId, startedAt: new Date() },
      update: { correlationId, error: null, finishedAt: null },
    });
    await db.lead.update({
      where: { id: leadId },
      data: { status: "PROCESSING", stage: "RECEIVED" },
    });

    let ctx: StageContext = {
      leadId,
      correlationId,
      lead,
      canonical: fromJson<CanonicalLead>(lead.canonicalData ?? {}),
      score: lead.score,
    };

    // --- VALIDATION ---------------------------------------------------------
    const validation = await withStage(
      db,
      { leadId, correlationId },
      "VALIDATION",
      async () => {
        const result = validateCanonical(ctx.canonical);
        await db.leadProcessing.update({
          where: { leadId },
          data: {
            validationStatus: result.ok ? "PASSED" : "FAILED",
            validationResult: json(result),
          },
        });
        if (!result.ok) {
          await this.markLeadTerminal(ctx, "REJECTED", "FAILED", result.errors.join(" "));
          return { status: "FAILED" as const, detail: { ok: false, errors: result.errors } };
        }
        return {
          status: "PASSED" as const,
          detail: { ok: true, warnings: result.warnings },
        };
      },
    );
    void validation;

    // Validation failure terminally rejects the lead — this is a business
    // outcome, so the job SUCCEEDS (no retry, no DLQ noise).
    const processingAfterValidation = await db.leadProcessing.findUnique({ where: { leadId } });
    if (processingAfterValidation?.validationStatus === "FAILED") {
      await recordStage(db, {
        leadId,
        stage: "COMPLETED",
        status: "FAILED",
        startedAt: new Date(),
        detail: { reason: "validation-failed" },
        correlationId,
      });
      return { outcome: "rejected", deliveries: 0 };
    }

    // --- NORMALIZATION ------------------------------------------------------
    await withStage(db, { leadId, correlationId }, "NORMALIZATION", async () => {
      const normalized = normalizeCanonical(ctx.canonical);
      ctx = { ...ctx, canonical: normalized.canonical };
      await db.lead.update({
        where: { id: leadId },
        data: {
          canonicalData: json(normalized.canonical),
          dedupEmailHash: normalized.dedupEmailHash ?? null,
          dedupPhoneHash: normalized.dedupPhoneHash ?? null,
        },
      });
      await db.leadProcessing.update({
        where: { leadId },
        data: {
          normalizationResult: json({
            email: normalized.canonical.email ?? null,
            phone: normalized.canonical.phone ?? null,
            name: normalized.canonical.name?.full ?? null,
            hasDedupHashes: Boolean(normalized.dedupEmailHash || normalized.dedupPhoneHash),
          }),
        },
      });
      return { status: "PASSED" as const, detail: { dedupHashes: Boolean(normalized.dedupEmailHash || normalized.dedupPhoneHash) } };
    });

    // --- DEDUPLICATION ------------------------------------------------------
    const duplicate = await this.runDeduplication(ctx);
    if (duplicate) {
      await db.lead.update({
        where: { id: leadId },
        data: { status: "PROCESSED", stage: "COMPLETED" },
      });
      await db.leadProcessing.update({
        where: { leadId },
        data: { finishedAt: new Date() },
      });
      await recordStage(db, {
        leadId,
        stage: "COMPLETED",
        status: "PASSED",
        startedAt: new Date(),
        detail: { reason: "duplicate-linked", duplicateOf: duplicate.originalLeadId },
        correlationId,
      });
      return { outcome: "duplicate", deliveries: 0 };
    }

    // --- ENRICHMENT ---------------------------------------------------------
    await this.runEnrichment(ctx);

    // --- SCORING ------------------------------------------------------------
    ctx = { ...ctx, score: await this.runScoring(ctx) };

    // --- ROUTING ------------------------------------------------------------
    const routing = await this.runRouting(ctx);

    if (routing.destinationIds.length === 0) {
      // INTERNAL_MIDDLEWARE fallback: no valid external destination, so the
      // lead simply stays inside Middleware. It is already persisted — this is
      // neither an external delivery success nor a failure, just a retained
      // lead that remains fully traceable (RoutingResult + stage events).
      await this.markLeadTerminal(ctx, "PROCESSED", "COMPLETED");
      await db.leadProcessing.update({ where: { leadId }, data: { finishedAt: new Date() } });
      await recordStage(db, {
        leadId,
        stage: "COMPLETED",
        status: "PASSED",
        startedAt: new Date(),
        // routing.reason carries the precise decision: no rule matched, or a
        // rule matched with no usable destination — both keep it in Middleware.
        detail: {
          reason: "no-destination-matched",
          routing: routing.reason,
          fallback: routing.fallback,
        },
        correlationId,
      });
      return { outcome: "no-destination", deliveries: 0 };
    }

    // --- MAPPING + FAN-OUT --------------------------------------------------
    const deliveries = await this.runMappingAndFanout(ctx, routing.destinationIds);

    // Stage QUEUED BEFORE enqueueing: if the queue write fails, the sweeper
    // finds QUEUED deliveries with no job and re-enqueues them (no data loss).
    await db.lead.update({ where: { id: leadId }, data: { stage: "QUEUED", status: "PROCESSING" } });
    await db.leadProcessing.update({ where: { leadId }, data: { finishedAt: new Date() } });

    for (const delivery of deliveries.enqueued) {
      await this.queues.enqueueDelivery({
        deliveryId: delivery.id,
        leadId,
        destinationId: delivery.destinationId,
        correlationId,
      });
    }

    // IMMEDIATE FINALIZATION when nothing was enqueued: every required
    // delivery row already existed (replay case) — if they are all terminal
    // the lead must settle NOW, not up to STALE_MS later via the sweeper.
    // finalizeLeadIfDone is CAS-guarded and no-ops while any delivery is
    // still in flight (that delivery's worker performs the finalization), so
    // the stale sweeper remains a pure crash-recovery safety net.
    if (deliveries.enqueued.length === 0) {
      await this.finalizeLeadIfDone(leadId, correlationId);
    }

    return { outcome: "distributed", deliveries: deliveries.total };
  }

  /** Single-stage re-run jobs (ENRICHMENT / SCORING / ROUTING queues). */
  async runSingleStage(
    job: { leadId: string; correlationId: string },
    stage: Extract<LeadStage, "ENRICHMENT" | "SCORING" | "ROUTING">,
  ): Promise<void> {
    const db = getPrisma();
    const lead = await db.lead.findFirst({
      where: { id: job.leadId },
      include: { source: true, sourceAccount: true },
    });
    if (!lead) throw new UnrecoverableError(`Lead ${job.leadId} not found`);

    const ctx: StageContext = {
      ...job,
      lead,
      canonical: fromJson<CanonicalLead>(lead.canonicalData ?? {}),
      score: lead.score,
    };

    if (stage === "ENRICHMENT") await this.runEnrichment(ctx);
    else if (stage === "SCORING") await this.runScoring(ctx);
    else {
      const routing = await this.runRouting(ctx);
      this.logger.log(
        `Routing re-run for lead ${job.leadId}: ${routing.destinationIds.length} destination(s) — ${routing.reason}`,
      );
    }
  }

  // ===========================================================================
  // Stages
  // ===========================================================================

  private async runDeduplication(
    ctx: StageContext,
  ): Promise<{ originalLeadId: string } | null> {
    const db = getPrisma();
    const { leadId, correlationId } = ctx;

    const outcome = await withStage(
      db,
      { leadId, correlationId },
      "DEDUPLICATION",
      async (): Promise<{ status: "PASSED" | "SKIPPED"; detail: Record<string, unknown>; value: { originalLeadId: string } | null }> => {
        const config = await db.deduplicationConfig.findUnique({ where: { instanceKey: "default" } });
        if (!config || !config.enabled) {
          await db.leadProcessing.update({
            where: { leadId },
            data: { deduplicationStatus: "DISABLED", deduplicationResult: json({ disabled: true }) },
          });
          return {
            status: "SKIPPED",
            detail: { reason: "deduplication-disabled" },
            value: null,
          };
        }

        const match = await this.findDuplicate(ctx, config.strategy, config.matchFields);
        if (match) {
          await db.leadDuplicate.upsert({
            where: { leadId },
            create: {
              leadId,
              originalLeadId: match.originalLeadId,
              strategy: match.strategy,
              matchedHash: match.matchedHash,
              confidence: 1,
            },
            update: { originalLeadId: match.originalLeadId, strategy: match.strategy, matchedHash: match.matchedHash },
          });
          await db.leadProcessing.update({
            where: { leadId },
            data: {
              deduplicationStatus: "DUPLICATE",
              deduplicationResult: json(match),
            },
          });
          return {
            status: "PASSED",
            detail: {
              duplicateOf: match.originalLeadId,
              strategy: match.strategy,
              policy: "linked-not-deleted; distribution skipped",
            },
            value: { originalLeadId: match.originalLeadId },
          };
        }

        await db.leadProcessing.update({
          where: { leadId },
          data: { deduplicationStatus: "UNIQUE", deduplicationResult: json({ unique: true }) },
        });
        return { status: "PASSED", detail: { unique: true }, value: null };
      },
    );
    return outcome ?? null;
  }

  private async findDuplicate(
    ctx: StageContext,
    strategy: string,
    matchFields: string[],
  ): Promise<{
    originalLeadId: string;
    strategy: "PHONE" | "EMAIL" | "PHONE_EMAIL" | "CUSTOM" | "EXTERNAL_ID";
    matchedHash: string | null;
  } | null> {
    const db = getPrisma();
    const { leadId } = ctx;

    const base = {
      id: { not: leadId },
    } satisfies Prisma.LeadWhereInput;

    const byHash = async (field: "dedupPhoneHash" | "dedupEmailHash") => {
      const value = field === "dedupPhoneHash" ? ctx.canonical.phone : ctx.canonical.email;
      if (!value) return null;
      const normalized = field === "dedupPhoneHash" ? normalizePhoneValue(value) : value.toLowerCase();
      const hashed = dedupHash(normalized);
      const found = await db.lead.findFirst({
        where: { ...base, [field]: hashed },
        orderBy: { receivedAt: "asc" },
        select: { id: true },
      });
      return found ? { originalLeadId: found.id, matchedHash: hashed } : null;
    };

    if (strategy === "PHONE" || strategy === "PHONE_EMAIL") {
      const m = await byHash("dedupPhoneHash");
      if (m) return { ...m, strategy: strategy === "PHONE" ? "PHONE" : "PHONE_EMAIL" };
      if (strategy === "PHONE") return null;
    }
    if (strategy === "EMAIL" || strategy === "PHONE_EMAIL") {
      const m = await byHash("dedupEmailHash");
      if (m) return { ...m, strategy: strategy === "EMAIL" ? "EMAIL" : "PHONE_EMAIL" };
      return null;
    }
    if (strategy === "EXTERNAL_ID") {
      // Enforced by the DB unique constraint (account, external id) —
      // a same-external-id lead cannot exist twice, so nothing to link here.
      return null;
    }
    if (strategy === "CUSTOM") {
      for (const field of matchFields.slice(0, 10)) {
        const value = resolveCustomValue(ctx.canonical, field);
        if (value === undefined || value === null || value === "") continue;
        const found = await db.lead.findFirst({
          where: {
            ...base,
            canonicalData: { path: [field], equals: value },
          },
          orderBy: { receivedAt: "asc" },
          select: { id: true },
        });
        if (found) {
          return {
            originalLeadId: found.id,
            strategy: "CUSTOM",
            matchedHash: hmacSha256Hex(`dedup:v1:${getEnv().ENCRYPTION_KEY}`, `${field}:${String(value)}`),
          };
        }
      }
    }
    return null;
  }

  private async runEnrichment(ctx: StageContext): Promise<void> {
    const db = getPrisma();
    await withStage(
      db,
      { leadId: ctx.leadId, correlationId: ctx.correlationId },
      "ENRICHMENT",
      async () => {
        // HONEST: no external enrichment provider is wired in Phase 1.
        await db.leadProcessing.update({
          where: { leadId: ctx.leadId },
          data: {
            enrichmentResult: json({
              skipped: true,
              reason: "No enrichment provider is configured. Enrichment is not implemented.",
            }),
          },
        });
        return {
          status: "SKIPPED" as const,
          detail: { reason: "no-enrichment-provider-configured", implemented: false },
        };
      },
    );
  }

  private async runScoring(ctx: StageContext): Promise<number | null> {
    const db = getPrisma();
    const { leadId, correlationId } = ctx;

    const outcome = await withStage(
      db,
      { leadId, correlationId },
      "SCORING",
      async (): Promise<{ status: "PASSED" | "SKIPPED"; detail: Record<string, unknown>; value: number | null }> => {
        const ruleset = await db.scoringRuleSet.findFirst({
          where: { enabled: true },
          orderBy: { createdAt: "desc" },
        });
        if (!ruleset) {
          return {
            status: "SKIPPED",
            detail: { reason: "no-active-scoring-ruleset" },
            value: null,
          };
        }

        const rules = Array.isArray(ruleset.rules) ? (ruleset.rules as unknown[]) : [];
        const condCtx: ConditionContext = {
          canonical: ctx.canonical as unknown as Record<string, unknown>,
          score: null,
          source: { type: ctx.lead.source?.type, code: ctx.lead.source?.code },
        };

        let score = 0;
        const breakdown: Array<{ rule: string; label: string; points: number; matched: boolean }> = [];
        for (const raw of rules) {
          if (!raw || typeof raw !== "object") continue;
          const rule = raw as { id?: string; label?: string; condition?: unknown; points?: number };
          if (typeof rule.condition !== "object" || rule.condition === null) continue;
          const matched = evaluateConditions([rule.condition as never], condCtx);
          const points = typeof rule.points === "number" ? rule.points : 0;
          if (matched) score += points;
          breakdown.push({
            rule: rule.id ?? "unknown",
            label: rule.label ?? rule.id ?? "unknown",
            points,
            matched,
          });
        }

        await db.leadScore.createMany({
          data: {
            leadId,
            score,
            version: ruleset.version,
            breakdown: json(breakdown),
          },
          skipDuplicates: true, // score history is immutable per (lead, version)
        });
        await db.lead.update({ where: { id: leadId }, data: { score, scoreVersion: ruleset.version } });

        return {
          status: "PASSED",
          detail: { score, version: ruleset.version, rules: breakdown.length },
          value: score,
        };
      },
    );
    return outcome ?? null;
  }

  /**
   * Evaluates the active routing rules and resolves the EXTERNAL destination
   * ids for this lead.
   *
   * The decision comes from the shared engine (`evaluateRouting` in
   * `@middleware/integrations`) — the same code the API preview endpoint
   * runs — so a preview always predicts what the pipeline will do.
   *
   * THE FALLBACK IS INTERNAL: `middleware` is THIS application, not a
   * Destination. When no valid external destination remains the engine returns
   * an empty `destinationIds` list together with the INTERNAL_MIDDLEWARE
   * decision — the lead is already persisted, so it simply stays in Middleware.
   * No Destination row is read or written, no Delivery row is created and
   * nothing is enqueued; the decision goes to RoutingResult + the ROUTING stage
   * event so the lead stays fully traceable.
   */
  private async runRouting(ctx: StageContext): Promise<RoutingOutcome> {
    const db = getPrisma();
    const { leadId, correlationId } = ctx;

    const outcome = await withStage(
      db,
      { leadId, correlationId },
      "ROUTING",
      async (): Promise<{ status: "PASSED"; detail: Record<string, unknown>; value: RoutingOutcome }> => {
        const rules = await db.routingRule.findMany({
          orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
          include: {
            destinations: { orderBy: { order: "asc" }, include: { destination: true } },
          },
        });

        const timezone = getEnv().APP_TIMEZONE;
        const condCtx: ConditionContext = {
          canonical: ctx.canonical as unknown as Record<string, unknown>,
          score: ctx.score,
          source: {
            type: ctx.lead.source?.type,
            code: ctx.lead.source?.code,
            name: ctx.lead.source?.name,
            id: ctx.lead.sourceId,
            accountId: ctx.lead.sourceAccountId,
            accountName: ctx.lead.sourceAccount?.name,
          },
          // Server-side receive time drives date/time/month/day conditions.
          receivedAt: ctx.lead.receivedAt,
          timezone,
        };

        const evaluation = evaluateRouting(
          rules.map<RoutingRuleInput>((rule) => ({
            id: rule.id,
            name: rule.name,
            priority: rule.priority,
            enabled: rule.enabled,
            stopOnMatch: rule.stopOnMatch,
            conditions: rule.conditions,
            destinations: rule.destinations.map((target) => ({
              id: target.destinationId,
              name: target.destination.name,
              type: target.destination.type,
              status: target.destination.status,
            })),
          })),
          condCtx,
        );

        await db.routingResult.create({
          data: {
            leadId,
            ruleId: evaluation.matchedRuleIds[0] ?? null,
            // EXTERNAL destinations only — the internal fallback never gets an
            // id here because there is no Destination row for it (by design).
            destinationIds: json(evaluation.destinationIds),
            matched: evaluation.matchedRuleIds.length > 0,
            // Carries `[INTERNAL_MIDDLEWARE]` when the lead stays in Middleware.
            reason: evaluation.reason,
            // NOTE: RoutingResult has no correlationId column. Correlation
            // lives on Lead.correlationId + the LeadStageEvent rows.
          },
        });

        const value: RoutingOutcome = {
          destinationIds: evaluation.destinationIds,
          reason: evaluation.reason,
          matched: evaluation.matchedRuleIds.length > 0,
          usedFallback: evaluation.usedFallback,
          fallback: evaluation.fallback,
        };

        return {
          status: "PASSED",
          detail: {
            matchedRules: evaluation.matchedRuleIds.length,
            ruleNames: evaluation.matchedRuleNames,
            // External destinations only: 0 means "kept in Middleware", which
            // is never counted as an external delivery (success OR failure).
            destinations: evaluation.destinationIds.length,
            fallback: evaluation.fallback,
            unavailableDestinations: evaluation.unavailableDestinationNames,
            matched: value.matched,
            usedFallback: evaluation.usedFallback,
            reason: evaluation.reason,
            timezone,
          },
          value,
        };
      },
    );
    return (
      outcome ?? {
        destinationIds: [],
        reason: "routing stage returned no outcome",
        matched: false,
        usedFallback: false,
        fallback: null,
      }
    );
  }

  private async runMappingAndFanout(
    ctx: StageContext,
    destinationIds: string[],
  ): Promise<{ total: number; enqueued: Array<{ id: string; destinationId: string }> }> {
    const db = getPrisma();
    const { leadId, correlationId } = ctx;

    return withStage(
      db,
      { leadId, correlationId },
      "MAPPING",
      async (): Promise<{
        status: "PASSED";
        detail: Record<string, unknown>;
        value: { total: number; enqueued: Array<{ id: string; destinationId: string }> };
      }> => {
        const env = getEnv();
        const mappingCtx: MappingContext = {
          lead: ctx.canonical,
          ...(ctx.score !== null ? { score: ctx.score } : {}),
        };

        const enqueued: Array<{ id: string; destinationId: string }> = [];
        const rejected: string[] = [];
        const reused: string[] = [];
        let configuredMappings = 0;

        for (const destinationId of destinationIds) {
          const destination = await db.destination.findFirst({
            where: { id: destinationId, status: "ACTIVE" },
          });
          if (!destination) continue;

          // Existing delivery identity: exactly one delivery per (lead, destination).
          const existing = await db.delivery.findFirst({
            where: { leadId, destinationId },
          });
          if (existing) {
            // Terminal-success/queued deliveries are never duplicated; FAILED/DEAD
            // rows wait for an explicit replay (data safety over auto-retry).
            reused.push(existing.status);
            continue;
          }

          const { fields, mappingName } = await this.loadActiveMapping(destinationId);
          if (fields) configuredMappings += 1;
          const outcome = fields
            ? applyFieldMapping(fields, mappingCtx)
            : { data: defaultMappedPayload(ctx.canonical, ctx.score), missingRequired: [] as string[], appliedCount: 0 };

          if (outcome.missingRequired.length > 0) {
            // Fail fast WITHOUT an external call: the mapping itself is broken.
            const delivery = await db.delivery.create({
              data: {
                leadId,
                destinationId,
                status: "FAILED",
                attemptCount: 1,
                mappedPayload: json(outcome.data),
                correlationId,
                completedAt: new Date(),
                errorCode: "DESTINATION_REJECTED",
                errorMessage: `Required fields missing in mapping: ${outcome.missingRequired.join(", ")}`,
              },
            });
            await db.deliveryAttempt.create({
              data: {
                deliveryId: delivery.id,
                attemptNumber: 1,
                status: "REJECTED",
                errorCode: "DESTINATION_REJECTED",
                errorCategory: "MAPPING",
                responseBody: null,
                durationMs: 0,
                requestMeta: json({ mapping: mappingName ?? "default", missingRequired: outcome.missingRequired }),
                finishedAt: new Date(),
                workerId: process.env.HOSTNAME ?? "worker-0",
              },
            });
            rejected.push(destinationId);
            continue;
          }

          const delivery = await db.delivery.create({
            data: {
              leadId,
              destinationId,
              status: "QUEUED",
              maxAttempts: env.DELIVERY_MAX_ATTEMPTS,
              mappedPayload: json(outcome.data),
              correlationId,
              enqueuedAt: new Date(),
            },
          });
          enqueued.push({ id: delivery.id, destinationId });
        }

        await recordStage(db, {
          leadId,
          stage: "QUEUED",
          status: "PASSED",
          startedAt: new Date(),
          detail: {
            toQueue: enqueued.length,
            rejectedMappings: rejected.length,
            reusedDeliveries: reused.length,
          },
          correlationId,
        });

        return {
          status: "PASSED",
          detail: {
            destinations: destinationIds.length,
            queued: enqueued.length,
            rejected: rejected.length,
            mappingConfigured: configuredMappings,
          },
          value: { total: destinationIds.length, enqueued },
        };
      },
    ).then((v) => v ?? { total: destinationIds.length, enqueued: [] });
  }

  private async loadActiveMapping(
    destinationId: string,
  ): Promise<{ fields: FieldMappingField[] | null; mappingName: string | null }> {
    const db = getPrisma();
    const mapping = await db.fieldMapping.findFirst({
      where: {
        destinationId,
        status: "ACTIVE",
        activeVersionId: { not: null },
      },
      include: { versions: true },
    });
    if (!mapping?.activeVersionId) return { fields: null, mappingName: null };
    const version = mapping.versions.find((v) => v.id === mapping.activeVersionId);
    if (!version) return { fields: null, mappingName: mapping.name };

    const raw = fromJson<unknown>(version.fields);
    if (!Array.isArray(raw)) return { fields: null, mappingName: mapping.name };
    const fields: FieldMappingField[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      if (typeof obj.source !== "string" || typeof obj.target !== "string") continue;
      fields.push(obj as unknown as FieldMappingField);
    }
    return { fields: fields.length > 0 ? fields : null, mappingName: mapping.name };
  }

  // ===========================================================================
  // Terminal transitions
  // ===========================================================================

  private async markLeadTerminal(
    ctx: StageContext,
    status: "REJECTED" | "PROCESSED",
    stage: "FAILED" | "COMPLETED",
    error?: string,
  ): Promise<void> {
    const db = getPrisma();
    await db.lead.update({
      where: { id: ctx.leadId },
      data: { status, stage },
    });
    await db.leadProcessing.update({
      where: { leadId: ctx.leadId },
      data: { finishedAt: new Date(), ...(error ? { error: error.slice(0, 2000) } : {}) },
    });
  }

  /**
   * Called by the delivery worker whenever a delivery reaches a terminal
   * state. When NO deliveries remain in flight the lead is finalized with a
   * real aggregate of delivery outcomes (never optimistic).
   *
   * Returns true when this call performed the finalization (CAS guard).
   */
  async finalizeLeadIfDone(leadId: string, correlationId?: string): Promise<boolean> {
    const db = getPrisma();
    const deliveries = await db.delivery.findMany({
      where: { leadId },
      select: { status: true },
    });
    const active = deliveries.filter((d) => !TERMINAL_DELIVERY_STATUSES.has(d.status));
    if (active.length > 0) return false;

    const total = deliveries.length;
    const succeeded = deliveries.filter((d) => d.status === "SUCCEEDED").length;
    const failed = total - succeeded;
    const success = total === 0 || succeeded > 0;

    // CAS: only the caller that flips QUEUED/DELIVERY → COMPLETED/FAILED wins.
    // A lead already finalized as FAILED may additionally be re-finalized when
    // the aggregate turned successful — an audited REPLAY can deliver a lead
    // after its first finalization, and the lead must then reflect reality.
    // Guarded twice: only on success, and only status=FAILED (REJECTED shares
    // stage=FAILED but has no deliveries, so it can never be resurrected).
    const flipped = await db.lead.updateMany({
      where: {
        id: leadId,
        OR: [
          { stage: { in: ["QUEUED", "DELIVERY", "MAPPING"] } },
          ...(success ? [{ stage: "FAILED" as const, status: "FAILED" as const }] : []),
        ],
      },
      data: success ? { stage: "COMPLETED", status: "PROCESSED" } : { stage: "FAILED", status: "FAILED" },
    });
    if (flipped.count === 0) return false;

    await db.leadProcessing
      .update({
        where: { leadId },
        data: success ? { finishedAt: new Date() } : { finishedAt: new Date(), error: "All deliveries failed" },
      })
      .catch(() => undefined);

    const startedAt = new Date();
    await recordStage(db, {
      leadId,
      stage: success ? "COMPLETED" : "FAILED",
      status: success ? "PASSED" : "FAILED",
      startedAt,
      detail: { total, succeeded, failed },
      ...(correlationId ? { correlationId } : {}),
      ...(success ? {} : { error: "Every delivery attempt for this lead failed." }),
    }).catch((err) => this.logger.error(`Failed to record final stage event for lead ${leadId}: ${String(err)}`));

    return true;
  }
}

function normalizePhoneValue(value: string): string {
  const hasPlus = value.includes("+");
  const digits = value.replace(/\D/g, "");
  if (digits === "") return value;
  return hasPlus ? `+${digits}` : digits;
}

function resolveCustomValue(canonical: CanonicalLead, field: string): unknown {
  const path = field.startsWith("custom.") ? field.slice(7) : field;
  let current: unknown = canonical;
  for (const seg of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

export { TERMINAL_DELIVERY_STATUSES };
