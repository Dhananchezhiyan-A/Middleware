import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { routingPreviewSchema, routingRuleUpsertSchema } from "@middleware/validation";

export class CreateRoutingRuleDto extends createZodDto(routingRuleUpsertSchema) {}

/** Dry-run body for POST /routing-rules/preview. */
export class PreviewRoutingRuleDto extends createZodDto(routingPreviewSchema) {}

/**
 * PATCH accepts any subset of the upsert fields.
 *
 * `.partial()` alone is not enough: the shared schema gives `enabled`,
 * `priority` and `stopOnMatch` defaults, which would fire for absent keys and
 * silently reset fields the caller never sent — so the defaults are stripped
 * first (`removeDefault()`), leaving "absent = unchanged".
 */
const upsertShape = routingRuleUpsertSchema.shape;
const routingRuleUpdateSchema = z.object({
  name: upsertShape.name.optional(),
  description: upsertShape.description.optional(),
  enabled: upsertShape.enabled.removeDefault().optional(),
  priority: upsertShape.priority.removeDefault().optional(),
  stopOnMatch: upsertShape.stopOnMatch.removeDefault().optional(),
  conditions: upsertShape.conditions.optional(),
  destinationIds: upsertShape.destinationIds.optional(),
});

export class UpdateRoutingRuleDto extends createZodDto(routingRuleUpdateSchema) {}
