import { z } from "zod";
import {
  DestinationTypes,
  ImportJobStatuses,
  LeadStatuses,
  MatchedFields,
  RuleOperators,
  SourceTypes,
} from "@middleware/types";

/** CUID / opaque id accepted anywhere an id is expected. */
export const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid identifier format");

export const cursorQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const dateRangeQuerySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export const emailSchema = z.email().max(254).transform((v) => v.toLowerCase().trim());

// Deliberately permissive: E.164-ish or local formats are normalized later.
export const phoneSchema = z
  .string()
  .min(5)
  .max(32)
  .regex(/^[+()\-\s\d]+$/, "Invalid phone number characters");

export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(128)
  .refine((v) => /[a-z]/.test(v), "Password must contain a lowercase letter")
  .refine((v) => /[A-Z]/.test(v), "Password must contain an uppercase letter")
  .refine((v) => /\d/.test(v), "Password must contain a digit");

// --- List queries -----------------------------------------------------------

export const leadListQuerySchema = cursorQuerySchema.extend({
  status: z.enum(LeadStatuses).optional(),
  sourceId: idSchema.optional(),
  destinationId: idSchema.optional(),
  scoreMin: z.coerce.number().int().min(0).max(1000).optional(),
  q: z.string().max(200).optional(),
  ...dateRangeQuerySchema.shape,
  sort: z.enum(["receivedAt:asc", "receivedAt:desc"]).optional(),
});

export const deliveryListQuerySchema = cursorQuerySchema.extend({
  status: z
    .enum(["PENDING", "QUEUED", "IN_PROGRESS", "SUCCEEDED", "FAILED", "DEAD", "SKIPPED"])
    .optional(),
  destinationId: idSchema.optional(),
  leadId: idSchema.optional(),
  ...dateRangeQuerySchema.shape,
});

export const auditListQuerySchema = cursorQuerySchema.extend({
  action: z.string().max(100).optional(),
  entityType: z.string().max(100).optional(),
  entityId: z.string().max(64).optional(),
  actorId: idSchema.optional(),
  ...dateRangeQuerySchema.shape,
});

export const importListQuerySchema = cursorQuerySchema.extend({
  status: z.enum(ImportJobStatuses).optional(),
  ...dateRangeQuerySchema.shape,
});

// --- Automation -------------------------------------------------------------

export const ruleConditionSchema = z.object({
  /** Dotted path: "canonical.city", "score", "source.type", "custom.budget". */
  field: z.string().min(1).max(120),
  operator: z.enum(RuleOperators),
  value: z.union([z.string().max(500), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()])).max(50)]).optional(),
});

export const routingRuleUpsertSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  enabled: z.boolean().default(true),
  priority: z.coerce.number().int().min(1).max(10_000).default(100),
  stopOnMatch: z.boolean().default(true),
  conditions: z.array(ruleConditionSchema).min(1).max(20),
  destinationIds: z.array(idSchema).min(1).max(20),
});

export const fieldMappingFieldSchema = z.object({
  source: z.string().min(1).max(200),
  target: z.string().min(1).max(200),
  required: z.boolean().optional(),
  defaultValue: z.union([z.string().max(2000), z.number(), z.boolean()]).optional(),
  transforms: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("uppercase") }),
        z.object({ type: z.literal("lowercase") }),
        z.object({ type: z.literal("trim") }),
        z.object({
          type: z.literal("template"),
          template: z.string().min(1).max(2000),
        }),
        z.object({ type: z.literal("coerce_number") }),
        z.object({ type: z.literal("coerce_string") }),
        z.object({ type: z.literal("coerce_boolean") }),
        z.object({
          type: z.literal("slice"),
          start: z.number().int(),
          end: z.number().int().optional(),
        }),
        z.object({
          type: z.literal("replace"),
          search: z.string().min(1).max(200),
          replace: z.string().max(200),
          regex: z.boolean().optional(),
        }),
        z.object({
          type: z.literal("default_if_empty"),
          value: z.union([z.string().max(2000), z.number(), z.boolean()]),
        }),
        z.object({ type: z.literal("prefix"), value: z.string().max(200) }),
        z.object({ type: z.literal("suffix"), value: z.string().max(200) }),
        z.object({
          type: z.literal("phone_e164"),
          defaultCountry: z.string().min(2).max(3),
        }),
      ]),
    )
    .max(10)
    .optional(),
});

export const fieldMappingCreateSchema = z.object({
  destinationId: idSchema,
  name: z.string().min(1).max(120),
  fields: z.array(fieldMappingFieldSchema).min(1).max(200),
  notes: z.string().max(2000).optional(),
  activate: z.boolean().default(false),
});

export const fieldMappingVersionSchema = z.object({
  fields: z.array(fieldMappingFieldSchema).min(1).max(200),
  notes: z.string().max(2000).optional(),
  activate: z.boolean().default(false),
});

export const dedupConfigSchema = z.object({
  enabled: z.boolean(),
  strategy: z.enum(MatchedFields),
  matchFields: z.array(z.string().min(1).max(64)).max(10).default([]),
});

export const scoringRuleSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  condition: ruleConditionSchema,
  points: z.number().int().min(-1000).max(1000),
});

export const scoringRuleSetUpsertSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(false),
  rules: z.array(scoringRuleSchema).min(1).max(100),
});

// --- Sources / Destinations -------------------------------------------------

export const sourceCreateSchema = z.object({
  type: z.enum(SourceTypes),
  code: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Code must be lowercase letters, numbers and hyphens"),
  name: z.string().min(1).max(120),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const sourceUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const sourceAccountCreateSchema = z.object({
  sourceId: idSchema,
  name: z.string().min(1).max(120),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const destinationCreateSchema = z.object({
  type: z.enum(DestinationTypes),
  name: z.string().min(1).max(120),
  config: z.record(z.string(), z.unknown()).default({}),
  rateLimitPerSec: z.coerce.number().int().min(1).max(1000).optional(),
});

export const destinationUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  rateLimitPerSec: z.coerce.number().int().min(1).max(1000).nullable().optional(),
});

/** Secrets are write-only: accepted on set/rotate, never returned. */
export const credentialSetSchema = z.object({
  type: z.enum(["WEBHOOK_HMAC", "API_KEY", "BASIC", "OAUTH", "BEARER"]),
  secret: z.string().min(1).max(8192),
  meta: z.record(z.string(), z.unknown()).default({}),
});

// --- Auth / system ----------------------------------------------------------

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.object({
  /** Optional when the httpOnly refresh cookie is present. */
  refreshToken: z.string().min(32).max(512).optional(),
});

export const userCreateSchema = z.object({
  email: emailSchema,
  name: z.string().min(1).max(120),
  password: passwordSchema,
  roleId: idSchema,
});

export const userUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  roleId: idSchema.optional(),
  status: z.enum(["ACTIVE", "INVITED", "DISABLED"]).optional(),
});

export const roleUpsertSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Role name must be lowercase words and hyphens"),
  description: z.string().max(500).optional(),
  permissions: z.array(z.string().min(1).max(64)).min(1).max(200),
});

export const apiKeyCreateSchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.string().min(1).max(64)).max(50).default([]),
  expiresInDays: z.coerce.number().int().min(1).max(3650).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
