import { Inject, Injectable } from "@nestjs/common";
import { getEnv } from "@middleware/config";
import { errors } from "@middleware/shared";
import type { Database, Prisma } from "@middleware/database";
import {
  evaluateRouting,
  type ConditionContext,
  type RoutingFallback,
  type RoutingRuleInput,
} from "@middleware/integrations";
import type { DestinationType, RequestActor } from "@middleware/types";
import { PRISMA } from "../../infra/prisma.module";
import { AuditService } from "../../infra/audit.module";

const RULE_INCLUDE = {
  destinations: {
    orderBy: { order: "asc" },
    select: { order: true, destination: { select: { id: true, name: true, type: true, status: true } } },
  },
} as const satisfies Prisma.RoutingRuleInclude;

type RuleRecord = Prisma.RoutingRuleGetPayload<{ include: typeof RULE_INCLUDE }>;

export interface RoutingRuleDestinationView {
  id: string;
  name: string;
  type: DestinationType;
  order: number;
}

export interface RoutingRuleView {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  priority: number;
  stopOnMatch: boolean;
  conditions: Prisma.JsonValue;
  version: number;
  updatedAt: Date;
  /** Last time this rule actually matched a lead (from RoutingResult). */
  lastMatchedAt: Date | null;
  destinations: RoutingRuleDestinationView[];
}

/** Dry-run input — never persists anything or enqueues a delivery. */
export interface RoutingPreviewInput {
  ruleIds?: string[];
  /** Unsaved rule(s) evaluated instead of the stored rules. */
  rules?: RoutingDraftRuleInput[];
  sourceId?: string;
  sourceAccountId?: string;
  receivedAt?: string;
  score?: number;
  canonical?: Record<string, unknown>;
}

export interface RoutingDraftRuleInput {
  name?: string;
  priority?: number;
  enabled?: boolean;
  stopOnMatch?: boolean;
  conditions: unknown;
  destinationIds: string[];
}

export interface RoutingPreviewClause {
  key: string;
  label: string;
  matched: boolean;
}

export interface RoutingPreviewRule {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  stopOnMatch: boolean;
  matched: boolean;
  skipped: boolean;
  clauses: RoutingPreviewClause[];
}

export interface RoutingPreviewView {
  /** Timezone used for date/time/month/day evaluation (APP_TIMEZONE). */
  timezone: string;
  /** Server-side receive time the preview evaluated. */
  receivedAt: Date;
  /** true when at least one rule matched — NOT the same as "deliverable". */
  matched: boolean;
  /** true when the lead stays inside Middleware (no external destination). */
  usedFallback: boolean;
  reason: string;
  rules: RoutingPreviewRule[];
  /** Valid EXTERNAL destinations only — an empty list means "kept in Middleware". */
  destinations: Array<{ id: string; name: string; type: DestinationType }>;
  /** How many of the matched destinations are actually deliverable. */
  validDestinationCount: number;
  /** Internal fallback decision — null when a valid external destination exists. */
  fallback: RoutingFallback | null;
  /** Number of EXTERNAL deliveries the pipeline would create (one per destination). */
  deliveryCount: number;
}

export interface RoutingRuleCreateInput {
  name: string;
  description?: string;
  enabled: boolean;
  priority: number;
  stopOnMatch: boolean;
  conditions: unknown;
  destinationIds: string[];
}

export interface RoutingRuleUpdateInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  priority?: number;
  stopOnMatch?: boolean;
  conditions?: unknown;
  destinationIds?: string[];
}

@Injectable()
export class RoutingRulesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Database,
    private readonly audit: AuditService,
  ) {}

  async listRules(): Promise<RoutingRuleView[]> {
    const rows = await this.prisma.routingRule.findMany({
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      include: RULE_INCLUDE,
    });

    // "Last Matched" per rule — one aggregate, not N queries.
    const lastMatched = new Map<string, Date>();
    if (rows.length > 0) {
      const grouped = await this.prisma.routingResult.groupBy({
        by: ["ruleId"],
        where: { ruleId: { in: rows.map((row) => row.id), not: null } },
        _max: { evaluatedAt: true },
      });
      for (const group of grouped) {
        if (group.ruleId && group._max.evaluatedAt) {
          lastMatched.set(group.ruleId, group._max.evaluatedAt);
        }
      }
    }

    return rows.map((row) => this.toView(row, lastMatched.get(row.id) ?? null));
  }

  async createRule(actor: RequestActor, input: RoutingRuleCreateInput): Promise<RoutingRuleView> {
    const destinationIds = await this.resolveDestinationIds(input.destinationIds);

    const created = await this.prisma.$transaction(async (tx) => {
      const rule = await tx.routingRule.create({
        data: {
          name: input.name,
          description: input.description,
          enabled: input.enabled,
          priority: input.priority,
          stopOnMatch: input.stopOnMatch,
          conditions: input.conditions as Prisma.InputJsonValue,
          version: 1,
        },
        select: { id: true },
      });
      await tx.routingRuleDestination.createMany({
        data: destinationIds.map((destinationId, order) => ({
          ruleId: rule.id,
          destinationId,
          order,
        })),
      });
      return rule;
    });

    const rule = await this.getRuleOrThrow(created.id);

    await this.audit.record({
      action: "routing.created",
      entityType: "RoutingRule",
      entityId: rule.id,
      actorId: actor.userId,
      actorLabel: actor.email || null,
      actorType: actor.actorType,
      after: {
        name: rule.name,
        description: rule.description,
        enabled: rule.enabled,
        priority: rule.priority,
        stopOnMatch: rule.stopOnMatch,
        version: rule.version,
        destinationIds,
      },
    });
    return this.toView(rule);
  }

  async updateRule(
    actor: RequestActor,
    id: string,
    input: RoutingRuleUpdateInput,
  ): Promise<RoutingRuleView> {
    const existing = await this.getRuleOrThrow(id);
    const beforeDestinationIds = existing.destinations.map((d) => d.destination.id);

    const destinationIds =
      input.destinationIds !== undefined
        ? await this.resolveDestinationIds(input.destinationIds)
        : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.routingRule.update({
        where: { id: existing.id },
        data: {
          version: existing.version + 1,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.stopOnMatch !== undefined ? { stopOnMatch: input.stopOnMatch } : {}),
          ...(input.conditions !== undefined
            ? { conditions: input.conditions as Prisma.InputJsonValue }
            : {}),
        },
      });
      if (destinationIds !== null) {
        await tx.routingRuleDestination.deleteMany({ where: { ruleId: existing.id } });
        await tx.routingRuleDestination.createMany({
          data: destinationIds.map((destinationId, order) => ({
            ruleId: existing.id,
            destinationId,
            order,
          })),
        });
      }
    });

    const updated = await this.getRuleOrThrow(existing.id);

    await this.audit.record({
      action: "routing.updated",
      entityType: "RoutingRule",
      entityId: updated.id,
      actorId: actor.userId,
      actorLabel: actor.email || null,
      actorType: actor.actorType,
      before: {
        rule: {
          name: existing.name,
          description: existing.description,
          enabled: existing.enabled,
          priority: existing.priority,
          stopOnMatch: existing.stopOnMatch,
          conditions: existing.conditions,
          version: existing.version,
        },
        destinationIds: beforeDestinationIds,
      },
      after: {
        rule: {
          name: updated.name,
          description: updated.description,
          enabled: updated.enabled,
          priority: updated.priority,
          stopOnMatch: updated.stopOnMatch,
          conditions: updated.conditions,
          version: updated.version,
        },
        destinationIds: updated.destinations.map((d) => d.destination.id),
      },
    });
    return this.toView(updated);
  }

  async deleteRule(actor: RequestActor, id: string): Promise<{ deleted: boolean }> {
    const existing = await this.prisma.routingRule.findFirst({
      where: { id },
      select: { id: true, name: true },
    });
    if (!existing) throw errors.notFound("Routing rule not found.");

    // RoutingRuleDestination rows are removed by the schema's cascade.
    await this.prisma.routingRule.delete({ where: { id: existing.id } });

    await this.audit.record({
      action: "routing.deleted",
      entityType: "RoutingRule",
      entityId: existing.id,
      actorId: actor.userId,
      actorLabel: actor.email || null,
      actorType: actor.actorType,
      before: { id: existing.id, name: existing.name },
    });
    return { deleted: true };
  }

  /**
   * Dry-run routing preview: evaluates rules against a SAMPLE lead and returns
   * per-condition results. Runs the exact same engine as the pipeline, but
   * never writes a RoutingResult, never creates deliveries and never enqueues.
   *
   * The preview distinguishes "rule matched" from "valid external destination
   * available": a matched rule whose destinations are all disabled still reports
   * `fallback: INTERNAL_MIDDLEWARE` and `deliveryCount: 0`.
   */
  async preview(_actor: RequestActor, input: RoutingPreviewInput): Promise<RoutingPreviewView> {
    const rules = await this.prisma.routingRule.findMany({
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      include: RULE_INCLUDE,
    });
    const selected = new Set(input.ruleIds ?? []);
    const stored = selected.size > 0 ? rules.filter((rule) => selected.has(rule.id)) : rules;

    /**
     * Draft rules (the rule being edited) win over stored rules so "Test rule"
     * reflects unsaved changes. Destination ids are resolved from the
     * Destinations module — unknown ids are simply dropped from the preview.
     */
    let candidateRules: RoutingRuleInput[];
    if (input.rules?.length) {
      const wantedIds = [...new Set(input.rules.flatMap((draft) => draft.destinationIds))];
      const knownDestinations = wantedIds.length
        ? await this.prisma.destination.findMany({
            where: { id: { in: wantedIds } },
            select: { id: true, name: true, type: true, status: true },
          })
        : [];
      const byId = new Map(knownDestinations.map((row) => [row.id, row]));
      candidateRules = input.rules.map((draft, index) => ({
        id: `draft-${index + 1}`,
        name: draft.name?.trim() || `Draft rule ${index + 1}`,
        priority: draft.priority ?? 100,
        enabled: draft.enabled ?? true,
        stopOnMatch: draft.stopOnMatch ?? false,
        conditions: draft.conditions,
        destinations: [
          ...new Set(draft.destinationIds),
        ].flatMap((destinationId) => {
          const row = byId.get(destinationId);
          return row
            ? [{ id: row.id, name: row.name, type: row.type, status: row.status }]
            : [];
        }),
      }));
    } else {
      candidateRules = stored.map<RoutingRuleInput>((rule) => ({
        id: rule.id,
        name: rule.name,
        priority: rule.priority,
        enabled: rule.enabled,
        stopOnMatch: rule.stopOnMatch,
        conditions: rule.conditions,
        destinations: rule.destinations.map((target) => ({
          id: target.destination.id,
          name: target.destination.name,
          type: target.destination.type,
          status: target.destination.status,
        })),
      }));
    }

    const source = input.sourceId
      ? await this.prisma.leadSource.findUnique({
          where: { id: input.sourceId },
          select: { id: true, type: true, code: true, name: true },
        })
      : null;
    const sourceAccount = input.sourceAccountId
      ? await this.prisma.leadSourceAccount.findUnique({
          where: { id: input.sourceAccountId },
          select: { id: true, name: true },
        })
      : null;

    // The fallback is INTERNAL (INTERNAL_MIDDLEWARE): Middleware itself, not a
    // Destination row. Nothing is looked up here — an unmatched lead simply
    // stays in the application, so the preview reports `fallback` as a decision
    // instead of a destination.
    const timezone = getEnv().APP_TIMEZONE;
    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
    const ctx: ConditionContext = {
      canonical: (input.canonical ?? {}) as Record<string, unknown>,
      score: input.score ?? null,
      source: {
        type: source?.type,
        code: source?.code,
        name: source?.name,
        id: input.sourceId ?? source?.id,
        accountId: input.sourceAccountId ?? sourceAccount?.id,
        accountName: sourceAccount?.name,
      },
      receivedAt,
      timezone,
    };

    const evaluation = evaluateRouting(candidateRules, ctx);

    const destinationsById = new Map<string, { id: string; name: string; type: DestinationType }>();
    for (const entry of evaluation.evaluated) {
      for (const target of entry.rule.destinations) {
        if (evaluation.destinationIds.includes(target.id)) {
          destinationsById.set(target.id, {
            id: target.id,
            name: target.name,
            type: target.type as DestinationType,
          });
        }
      }
    }

    const validDestinations = evaluation.destinationIds.map(
      (id) =>
        destinationsById.get(id) ?? { id, name: id, type: "WEBHOOK" as DestinationType },
    );

    return {
      timezone,
      receivedAt,
      matched: evaluation.matchedRuleIds.length > 0,
      usedFallback: evaluation.usedFallback,
      reason: evaluation.reason,
      rules: evaluation.evaluated.map((entry) => ({
        id: entry.rule.id,
        name: entry.rule.name,
        priority: entry.rule.priority,
        enabled: entry.rule.enabled,
        stopOnMatch: entry.rule.stopOnMatch,
        matched: entry.matched,
        skipped: entry.skipped,
        clauses: entry.clauses,
      })),
      destinations: validDestinations,
      validDestinationCount: validDestinations.length,
      // Internal fallback: null once a valid external destination exists.
      fallback: evaluation.fallback,
      // EXTERNAL deliveries only — the INTERNAL_MIDDLEWARE fallback creates none.
      deliveryCount: evaluation.destinationIds.length,
    };
  }

  /** Dedupes and verifies every destination exists (422 with a missing-id list). */
  private async resolveDestinationIds(destinationIds: string[]): Promise<string[]> {
    const uniqueIds = [...new Set(destinationIds)];
    const found = await this.prisma.destination.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true },
    });
    const foundIds = new Set(found.map((d) => d.id));
    const missing = uniqueIds.filter((destinationId) => !foundIds.has(destinationId));
    if (missing.length > 0) {
      throw errors.validation("One or more destinations were not found.", { missing });
    }
    return uniqueIds;
  }

  private async getRuleOrThrow(id: string): Promise<RuleRecord> {
    const rule = await this.prisma.routingRule.findFirst({
      where: { id },
      include: RULE_INCLUDE,
    });
    if (!rule) throw errors.notFound("Routing rule not found.");
    return rule;
  }

  private toView(rule: RuleRecord, lastMatchedAt: Date | null = null): RoutingRuleView {
    return {
      id: rule.id,
      name: rule.name,
      description: rule.description,
      enabled: rule.enabled,
      priority: rule.priority,
      stopOnMatch: rule.stopOnMatch,
      conditions: rule.conditions,
      version: rule.version,
      updatedAt: rule.updatedAt,
      lastMatchedAt,
      destinations: rule.destinations.map((entry) => ({
        id: entry.destination.id,
        name: entry.destination.name,
        type: entry.destination.type,
        order: entry.order,
      })),
    };
  }
}
