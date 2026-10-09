/**
 * Canonical enum values.
 *
 * NOTE: These MUST stay in sync with the Prisma schema enums
 * (prisma/schema.prisma). A drift test lives in
 * packages/types/src/enums.spec.ts — it fails if the two diverge.
 */

export const LeadStatuses = [
  "RECEIVED",
  "PROCESSING",
  "PROCESSED",
  "REJECTED",
  "FAILED",
] as const;
export type LeadStatus = (typeof LeadStatuses)[number];

export const LeadStages = [
  "RECEIVED",
  "VALIDATION",
  "NORMALIZATION",
  "DEDUPLICATION",
  "ENRICHMENT",
  "SCORING",
  "ROUTING",
  "MAPPING",
  "QUEUED",
  "DELIVERY",
  "COMPLETED",
  "FAILED",
] as const;
export type LeadStage = (typeof LeadStages)[number];

export const StageStatuses = ["PENDING", "RUNNING", "PASSED", "FAILED", "SKIPPED"] as const;
export type StageStatus = (typeof StageStatuses)[number];

export const ValidationStatuses = ["PENDING", "PASSED", "FAILED"] as const;
export type ValidationStatus = (typeof ValidationStatuses)[number];

export const DeduplicationStatuses = ["PENDING", "UNIQUE", "DUPLICATE", "DISABLED"] as const;
export type DeduplicationStatus = (typeof DeduplicationStatuses)[number];

export const WebhookEventStatuses = [
  "RECEIVED",
  "PROCESSED",
  "FAILED",
  "DUPLICATE",
] as const;
export type WebhookEventStatus = (typeof WebhookEventStatuses)[number];

export const SourceTypes = [
  "GOOGLE_ADS",
  "META_ADS",
  "WEBSITE",
  "LINKEDIN",
  "API",
  "WEBHOOK",
  "CSV",
  "CUSTOM",
] as const;
export type SourceType = (typeof SourceTypes)[number];

export const DestinationTypes = [
  "SALESFORCE",
  "ZOHO",
  "DCT_CRM",
  "HUBSPOT",
  "PIPEDRIVE",
  "CUSTOM_API",
  "WEBHOOK",
] as const;
export type DestinationType = (typeof DestinationTypes)[number];

export const DestinationStatuses = ["ACTIVE", "DISABLED"] as const;
export type DestinationStatus = (typeof DestinationStatuses)[number];

export const ConnectionStatuses = [
  "NOT_CONFIGURED",
  "CONNECTED",
  "DISCONNECTED",
  "ERROR",
] as const;
export type ConnectionStatus = (typeof ConnectionStatuses)[number];

export const DeliveryStatuses = [
  "PENDING",
  "QUEUED",
  "IN_PROGRESS",
  "SUCCEEDED",
  "FAILED",
  "DEAD",
  "SKIPPED",
] as const;
export type DeliveryStatus = (typeof DeliveryStatuses)[number];

export const DeliveryAttemptStatuses = [
  "SUCCEEDED",
  "FAILED",
  "TIMEOUT",
  "RATE_LIMITED",
  "NOT_CONFIGURED",
  "REJECTED",
] as const;
export type DeliveryAttemptStatus = (typeof DeliveryAttemptStatuses)[number];

export const CredentialTypes = ["WEBHOOK_HMAC", "API_KEY", "BASIC", "OAUTH", "BEARER"] as const;
export type CredentialType = (typeof CredentialTypes)[number];

export const ImportJobStatuses = [
  "PENDING",
  "PARSING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type ImportJobStatus = (typeof ImportJobStatuses)[number];

export const AuditActorTypes = ["USER", "API_KEY", "SYSTEM", "WORKER"] as const;
export type AuditActorType = (typeof AuditActorTypes)[number];

export const RuleOperators = [
  "EQ",
  "NEQ",
  "CONTAINS",
  "NOT_CONTAINS",
  "STARTS_WITH",
  "ENDS_WITH",
  "GT",
  "GTE",
  "LT",
  "LTE",
  "IN",
  "NOT_IN",
  "EXISTS",
  "NOT_EXISTS",
  // Date / range operators (field-type aware — see RULE_OPERATOR_GROUPS).
  "BETWEEN",
  "BEFORE",
  "AFTER",
] as const;
export type RuleOperator = (typeof RuleOperators)[number];

/** Operators offered per field type so the builder never shows an invalid one. */
export const RULE_OPERATOR_GROUPS = {
  text: ["EQ", "NEQ", "CONTAINS", "NOT_CONTAINS", "STARTS_WITH", "ENDS_WITH", "IN", "NOT_IN", "EXISTS", "NOT_EXISTS"],
  number: ["EQ", "NEQ", "GT", "GTE", "LT", "LTE", "BETWEEN", "IN", "NOT_IN", "EXISTS", "NOT_EXISTS"],
  date: ["EQ", "BEFORE", "AFTER", "BETWEEN", "EXISTS", "NOT_EXISTS"],
  enum: ["EQ", "NEQ", "IN", "NOT_IN", "EXISTS", "NOT_EXISTS"],
} as const satisfies Record<string, readonly RuleOperator[]>;
export type RuleOperatorGroup = keyof typeof RULE_OPERATOR_GROUPS;

/** How top-level clauses of a routing rule combine. */
export const RoutingMatchModes = ["ALL", "ANY"] as const;
export type RoutingMatchMode = (typeof RoutingMatchModes)[number];

/**
 * Relative/absolute date presets for the routing DATE condition.
 * Presets are evaluated against the lead's server-side received time in the
 * application timezone — never the browser's clock.
 */
export const DatePresets = [
  "today",
  "yesterday",
  "last_7_days",
  "last_30_days",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "before",
  "after",
  "between",
] as const;
export type DatePreset = (typeof DatePresets)[number];

/** Index = 1..12 (January..December), matching the routing MONTH condition. */
export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Index = 1..7 Monday..Sunday (ISO-8601), matching the routing DAY condition. */
export const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

/**
 * Internal routing fallback: "Middleware" is THIS application, not an external
 * destination. When no valid external destination is selected the lead simply
 * stays inside Middleware — no Delivery row, no outbound request, no queue job.
 *
 * The identifier is stored in `RoutingResult.reason` (and the ROUTING stage
 * detail) so analytics and the UI can recognise the outcome without needing a
 * Destination row that would only represent the application itself.
 */
export const ROUTING_FALLBACK_TYPE = "INTERNAL_MIDDLEWARE";
export type RoutingFallbackType = typeof ROUTING_FALLBACK_TYPE;

/** Human label used by the UI ("Fallback: Internal Middleware"). */
export const ROUTING_FALLBACK_LABEL = "Internal Middleware";

export const MatchedFields = ["EXTERNAL_ID", "PHONE", "EMAIL", "PHONE_EMAIL", "CUSTOM"] as const;
export type MatchedField = (typeof MatchedFields)[number];

export const FieldMappingStatuses = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
export type FieldMappingStatus = (typeof FieldMappingStatuses)[number];

export const TenantStatuses = ["ACTIVE", "SUSPENDED"] as const;
export type TenantStatus = (typeof TenantStatuses)[number];

export const UserStatuses = ["ACTIVE", "INVITED", "DISABLED"] as const;
export type UserStatus = (typeof UserStatuses)[number];
