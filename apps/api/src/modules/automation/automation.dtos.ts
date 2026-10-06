import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { dedupConfigSchema, scoringRuleSetUpsertSchema } from "@middleware/validation";

export class CreateScoringRuleSetDto extends createZodDto(scoringRuleSetUpsertSchema) {}
/** PATCH /automation/scoring/:id body — enable or disable a rule set. */
export class ToggleScoringRuleSetDto extends createZodDto(
  z.object({ enabled: z.boolean() }),
) {}
export class UpsertDedupConfigDto extends createZodDto(dedupConfigSchema) {}
