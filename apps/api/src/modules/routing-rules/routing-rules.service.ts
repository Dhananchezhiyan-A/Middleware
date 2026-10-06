import { Inject, Injectable } from "@nestjs/common";
import { errors } from "@middleware/shared";
import type { Database, Prisma } from "@middleware/database";
import type { DestinationType, RequestActor } from "@middleware/types";
import { PRISMA } from "../../infra/prisma.module";
import { AuditService } from "../../infra/audit.module";

const RULE_INCLUDE = {
  destinations: {
    orderBy: { order: "asc" },
    select: { order: true, destination: { select: { id: true, name: true, type: true } } },
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
  destinations: RoutingRuleDestinationView[];
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
    return rows.map((row) => this.toView(row));
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

  private toView(rule: RuleRecord): RoutingRuleView {
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
      destinations: rule.destinations.map((entry) => ({
        id: entry.destination.id,
        name: entry.destination.name,
        type: entry.destination.type,
        order: entry.order,
      })),
    };
  }
}
