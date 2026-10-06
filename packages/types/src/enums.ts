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
] as const;
export type RuleOperator = (typeof RuleOperators)[number];

export const MatchedFields = ["EXTERNAL_ID", "PHONE", "EMAIL", "PHONE_EMAIL", "CUSTOM"] as const;
export type MatchedField = (typeof MatchedFields)[number];

export const FieldMappingStatuses = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
export type FieldMappingStatus = (typeof FieldMappingStatuses)[number];

export const TenantStatuses = ["ACTIVE", "SUSPENDED"] as const;
export type TenantStatus = (typeof TenantStatuses)[number];

export const UserStatuses = ["ACTIVE", "INVITED", "DISABLED"] as const;
export type UserStatus = (typeof UserStatuses)[number];
