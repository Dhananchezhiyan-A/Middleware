import { Inject, Injectable } from "@nestjs/common";
import { errors } from "@middleware/shared";
import type { Database, Prisma } from "@middleware/database";
import type { MatchedField, RequestActor } from "@middleware/types";
import { PRISMA } from "../../infra/prisma.module";
import { AuditService } from "../../infra/audit.module";

const SCORING_SELECT = {
  id: true,
  name: true,
  version: true,
  enabled: true,
  rules: true,
  activatedAt: true,
  createdAt: true,
} satisfies Prisma.ScoringRuleSetSelect;

export type ScoringRuleSetView = Prisma.ScoringRuleSetGetPayload<{
  select: typeof SCORING_SELECT;
}>;

export interface ScoringRuleSetCreateInput {
  name: string;
  enabled: boolean;
  rules: unknown[];
}

export interface DedupConfigInput {
  enabled: boolean;
  strategy: MatchedField;
  matchFields: string[];
}

export interface DedupConfigView {
  id: string;
  enabled: boolean;
  strategy: MatchedField;
  matchFields: string[];
  updatedAt: Date;
}

/** Reads the Prisma error code without importing the client runtime. */
function prismaErrorCode(err: unknown): string | undefined {
  if (err !== null && typeof err === "object" && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return undefined;
}

@Injectable()
export class AutomationService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Database,
    private readonly audit: AuditService,
  ) {}

  async listScoringRuleSets(): Promise<ScoringRuleSetView[]> {
    return this.prisma.scoringRuleSet.findMany({
      orderBy: { createdAt: "desc" },
      select: SCORING_SELECT,
    });
  }

  /**
   * Creates the next immutable version of the scoring rule set.
   * When `enabled`, every other set is disabled in the SAME transaction so
   * exactly one set is ever active.
   */
  async createScoringRuleSet(
    actor: RequestActor,
    input: ScoringRuleSetCreateInput,
  ): Promise<ScoringRuleSetView> {
    let created: ScoringRuleSetView;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const count = await tx.scoringRuleSet.count();
        const version = `v${count + 1}`;
        if (input.enabled) {
          await tx.scoringRuleSet.updateMany({
            where: { enabled: true },
            data: { enabled: false },
          });
        }
        return tx.scoringRuleSet.create({
          data: {
            name: input.name,
            version,
            enabled: input.enabled,
            rules: input.rules as Prisma.InputJsonValue,
            activatedAt: input.enabled ? new Date() : null,
          },
          select: SCORING_SELECT,
        });
      });
    } catch (err) {
      if (prismaErrorCode(err) === "P2002") {
        throw errors.conflict("A scoring rule set with this version already exists.");
      }
      throw err;
    }

    await this.audit.record({
      action: "scoring.version_created",
      entityType: "ScoringRuleSet",
      entityId: created.id,
      actorId: actor.userId,
      actorLabel: actor.email || null,
      actorType: actor.actorType,
      after: { name: created.name, version: created.version, enabled: created.enabled },
      metadata: { version: created.version, enabled: created.enabled },
    });
    return created;
  }

  async toggleScoringRuleSet(
    actor: RequestActor,
    id: string,
    input: { enabled: boolean },
  ): Promise<ScoringRuleSetView> {
    const existing = await this.prisma.scoringRuleSet.findFirst({
      where: { id },
      select: { id: true, name: true, version: true, enabled: true },
    });
    if (!existing) throw errors.notFound("Scoring rule set not found.");

    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.enabled) {
        // Activation is exclusive: every other set is turned off atomically.
        await tx.scoringRuleSet.updateMany({
          where: { enabled: true, id: { not: existing.id } },
          data: { enabled: false },
        });
      }
      return tx.scoringRuleSet.update({
        where: { id: existing.id },
        data: {
          enabled: input.enabled,
          ...(input.enabled ? { activatedAt: new Date() } : {}),
        },
        select: SCORING_SELECT,
      });
    });

    await this.audit.record({
      action: "scoring.toggled",
      entityType: "ScoringRuleSet",
      entityId: updated.id,
      actorId: actor.userId,
      actorLabel: actor.email || null,
      actorType: actor.actorType,
      before: { version: existing.version, enabled: existing.enabled },
      after: { version: updated.version, enabled: updated.enabled },
    });
    return updated;
  }

  /**
   * Returns the application's dedup config, lazily creating the documented default
   * (disabled, PHONE strategy) when it does not exist yet.
   */
  async getDedupConfig(): Promise<DedupConfigView> {
    const existing = await this.prisma.deduplicationConfig.findUnique({ where: { instanceKey: "default" } });
    if (existing) return this.toDedupView(existing);

    try {
      const created = await this.prisma.deduplicationConfig.create({
        data: { instanceKey: "default", enabled: false, strategy: "PHONE" },
      });
      return this.toDedupView(created);
    } catch (err) {
      // Lost a create race against a concurrent request — read the winner.
      if (prismaErrorCode(err) === "P2002") {
        const raced = await this.prisma.deduplicationConfig.findUnique({ where: { instanceKey: "default" } });
        if (raced) return this.toDedupView(raced);
      }
      throw err;
    }
  }

  async upsertDedupConfig(actor: RequestActor, input: DedupConfigInput): Promise<DedupConfigView> {
    const current = await this.prisma.deduplicationConfig.findUnique({
      where: { instanceKey: "default" },
    });

    const saved = await this.prisma.deduplicationConfig.upsert({
      where: { instanceKey: "default" },
      update: {
        enabled: input.enabled,
        strategy: input.strategy,
        matchFields: input.matchFields,
      },
      create: {
        instanceKey: "default",
        enabled: input.enabled,
        strategy: input.strategy,
        matchFields: input.matchFields,
      },
    });

    const before = current
      ? {
          id: current.id,
          enabled: current.enabled,
          strategy: current.strategy,
          matchFields: current.matchFields,
        }
      : null;
    const after = {
      id: saved.id,
      enabled: saved.enabled,
      strategy: saved.strategy,
      matchFields: saved.matchFields,
    };

    await this.audit.record({
      action: "dedup.updated",
      entityType: "DeduplicationConfig",
      entityId: saved.id,
      actorId: actor.userId,
      actorLabel: actor.email || null,
      actorType: actor.actorType,
      before,
      after,
    });
    return this.toDedupView(saved);
  }

  /**
   * Honest status marker: no enrichment providers are wired up in this phase.
   * This reports real (empty) state — it never invents providers.
   */
  getEnrichmentStatus(): { implemented: boolean; providers: string[]; note: string } {
    return {
      implemented: false,
      providers: [],
      note: "Enrichment providers are not configured in this phase.",
    };
  }

  private toDedupView(config: {
    id: string;
    enabled: boolean;
    strategy: MatchedField;
    matchFields: string[];
    updatedAt: Date;
  }): DedupConfigView {
    return {
      id: config.id,
      enabled: config.enabled,
      strategy: config.strategy,
      matchFields: config.matchFields,
      updatedAt: config.updatedAt,
    };
  }
}
