import type { Database } from "@middleware/database";
import type { LeadStage, StageStatus } from "@middleware/types";

/**
 * LeadStageEvent writer — the append-only pipeline timeline shown in the UI.
 *
 * Stage events are IMMUTABLE: they are created once per stage execution and
 * never updated, so reprocessing a lead appends history instead of rewriting it.
 */

export interface StageEventInput {
  leadId: string;
  stage: LeadStage;
  status: StageStatus;
  startedAt: Date;
  finishedAt?: Date;
  detail?: Record<string, unknown>;
  error?: string;
  correlationId?: string;
}

export async function recordStage(db: Database, input: StageEventInput): Promise<void> {
  await db.leadStageEvent.create({
    data: {
      leadId: input.leadId,
      stage: input.stage,
      status: input.status,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt ?? new Date(),
      durationMs: Math.max(0, (input.finishedAt ?? new Date()).getTime() - input.startedAt.getTime()),
      ...(input.detail !== undefined ? { detail: input.detail as never } : {}),
      ...(input.error !== undefined ? { error: input.error.slice(0, 2000) } : {}),
      ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    },
  });
}

/** Runs a stage, always recording a PASSED/FAILED/SKIPPED event with timing. */
export async function withStage<T>(
  db: Database,
  base: { leadId: string; correlationId?: string },
  stage: LeadStage,
  fn: () => Promise<{ status: StageStatus; detail?: Record<string, unknown>; value?: T }>,
): Promise<T | undefined> {
  const startedAt = new Date();
  try {
    const outcome = await fn();
    await recordStage(db, {
      ...base,
      stage,
      status: outcome.status,
      startedAt,
      detail: outcome.detail,
    });
    return outcome.value;
  } catch (err) {
    await recordStage(db, {
      ...base,
      stage,
      status: "FAILED",
      startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
