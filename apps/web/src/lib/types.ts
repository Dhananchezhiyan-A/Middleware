/**
 * Frontend DTOs mirroring the API contract (apps/api, Phase 1).
 *
 * These describe what the HTTP layer returns after envelope unwrapping.
 * Shared enums/contracts (LeadStatus, CursorPage, Permission, …) come from
 * @middleware/types — never re-declared here.
 */

import type {
  CursorPage,
  DeduplicationStatus,
  DeliveryStatus,
  FieldMappingStatus,
  LeadStage,
  LeadStatus,
  StageStatus,
  ValidationStatus,
} from "@middleware/types";

/** Re-export the shared contract types so views can import everything from one place. */
export type {
  CursorPage,
  DeduplicationStatus,
  DeliveryStatus,
  FieldMappingStatus,
  LeadStage,
  LeadStatus,
  StageStatus,
  ValidationStatus,
} from "@middleware/types";

/* ---------------------------------- auth ---------------------------------- */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
  user: SessionUser;
}

export interface MeResult {
  user: {
    id: string;
    email: string;
    role: string;
    permissions: string[];
    actorType: string;
    name?: string;
  };
}

/* -------------------------------- analytics -------------------------------- */

/** Grouped counters returned as `Object.fromEntries(groupBy…)`. */
export type StatusCounts = Partial<Record<LeadStatus, number>>;
export type DeliveryCounts = Partial<Record<DeliveryStatus, number>>;

/** GET /analytics/overview — real PostgreSQL aggregates (no synthetic values). */
export interface AnalyticsOverview {
  leads: {
    total24h: number;
    total7d: number;
    total30d: number;
    byStatus: StatusCounts;
  };
  deliveries: {
    total: number;
    succeeded: number;
    failedOrDead: number;
    successRate: number | null;
    avgAttemptsOnSuccess: number | null;
    byStatus: DeliveryCounts;
  };
  inbound: { webhookEvents24h: number };
  topSources: OverviewSourceRow[];
  topDestinations: OverviewDestinationRow[];
  generatedAt: string;
}

export interface OverviewSourceRow {
  sourceId: string;
  _count: { _all: number };
  source: { id: string; name: string; code: string; type: string } | null;
}

export interface OverviewDestinationRow {
  destinationId: string;
  _count: { _all: number };
  destination: { id: string; name: string; type: string } | null;
}

export interface TimeseriesPoint {
  date: string;
  count: number;
}

/** GET /analytics/timeseries — daily intake and delivery outcomes. */
export interface TimeseriesSeries {
  days: number;
  leads: TimeseriesPoint[];
  deliveries: TimeseriesPoint[];
}

/** GET /analytics/sources — per-source lead counts grouped by status. */
export interface SourcePerformanceRow {
  source: { id: string; name: string; code: string; type: string };
  total: number;
  byStatus: StatusCounts;
}

/** GET /analytics/destinations — per-destination delivery outcomes + latency. */
export interface DestinationPerformanceRow {
  destination: { id: string; name: string; type: string; status: string };
  total: number;
  succeeded: number;
  byStatus: DeliveryCounts;
  successRate: number | null;
  avgLatencyMs: number | null;
}

/** GET /analytics/pipeline — leads grouped by current stage. */
export interface PipelineFunnel {
  total: number;
  stages: { stage: LeadStage; count: number; share: number }[];
}

/** Aggregated payload composed by `useDashboard()` from the analytics routes. */
export interface DashboardResult {
  overview: AnalyticsOverview;
  series: TimeseriesSeries;
  sources: SourcePerformanceRow[];
  destinations: DestinationPerformanceRow[];
  pipeline: PipelineFunnel;
}

/* ---------------------------------- leads ---------------------------------- */

export interface LeadName {
  first?: string;
  last?: string;
  full?: string;
}

export interface LeadLocation {
  city?: string;
  state?: string;
  country?: string;
}

export interface LeadCanonicalData {
  name?: LeadName;
  email?: string;
  phone?: string;
  location?: LeadLocation;
  budget?: number;
  currency?: string;
  project?: string;
  custom?: Record<string, unknown>;
}

export interface LeadListItem {
  id: string;
  leadId: string;
  externalLeadId?: string | null;
  status: LeadStatus;
  stage: LeadStage;
  score?: number | null;
  scoreVersion?: string | null;
  source: { id: string; type: string; name: string };
  canonicalData: LeadCanonicalData;
  receivedAt: string;
  createdAt: string;
  updatedAt: string;
  correlationId?: string | null;
}

export type LeadListPage = CursorPage<LeadListItem>;

export interface RawPayload {
  id: string;
  payload: unknown;
  headers?: Record<string, unknown> | null;
  checksum?: string | null;
  receivedAt: string;
}

export interface LeadProcessing {
  validationStatus?: ValidationStatus;
  deduplicationStatus?: DeduplicationStatus;
  validationResult?: unknown;
  normalizationResult?: unknown;
  deduplicationResult?: unknown;
  enrichmentResult?: unknown;
  routingResult?: unknown;
  correlationId?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: string | null;
}

export interface StageEvent {
  id: string;
  stage: LeadStage;
  status: StageStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  detail?: unknown;
  error?: string | null;
}

export interface LeadScore {
  id: string;
  score: number;
  /** Rule set version, e.g. "3" (string in the database). */
  version: string;
  breakdown?: unknown;
  computedAt: string;
}

export interface LeadDuplicateLink {
  /** Present only on rows that carry it; the detail select exposes the target id. */
  leadId?: string;
  originalLeadId: string;
  strategy: string;
  confidence?: number | null;
  createdAt?: string;
}

export interface RoutingResult {
  id: string;
  ruleId?: string | null;
  ruleName?: string | null;
  destinationIds?: string[];
  matched: boolean;
  reason?: string | null;
  evaluatedAt: string;
}

export interface DeliveryAttempt {
  id: string;
  attemptNumber: number;
  status: string;
  responseStatus?: number | null;
  responseBody?: string | null;
  errorCode?: string | null;
  errorCategory?: string | null;
  durationMs?: number | null;
  externalId?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface LeadDelivery {
  id: string;
  status: DeliveryStatus;
  attemptCount: number;
  maxAttempts: number;
  externalId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  mappedPayload?: unknown;
  createdAt: string;
  updatedAt: string;
  destination: { id: string; name: string; type: string };
  attempts: DeliveryAttempt[];
}

/**
 * Lead detail view model.
 *
 * The API has no single "everything" route; `useLead()` composes it from
 *   GET /leads/:id         → row + source, sourceAccount, processing, scores,
 *                            duplicateOf, deliveries(attempts)
 *   GET /leads/:id/timeline→ stageEvents, scores, routingResults
 *   GET /leads/:id/payloads→ raw payloads + normalized snapshot
 * Fields the API does not expose (reverse duplicate links) are simply absent.
 */
export interface LeadDetail {
  id: string;
  leadId: string;
  externalLeadId?: string | null;
  status: LeadStatus;
  stage: LeadStage;
  score?: number | null;
  scoreVersion?: string | null;
  source: { id: string; type: string; name: string; code?: string };
  sourceAccount?: { id: string; name: string; publicId: string } | null;
  canonicalData: LeadCanonicalData;
  normalizedData?: unknown;
  receivedAt: string;
  createdAt: string;
  updatedAt: string;
  correlationId?: string | null;
  rawPayloads: RawPayload[];
  processing: LeadProcessing | null;
  stageEvents: StageEvent[];
  scores: LeadScore[];
  duplicateOf: LeadDuplicateLink | null;
  routingResults: RoutingResult[];
  deliveries: LeadDelivery[];
}

export interface LeadAuditEntry {
  id: string;
  action: string;
  actorLabel?: string | null;
  actorType?: string | null;
  entityType?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  correlationId?: string | null;
  createdAt: string;
}

/* --------------------------------- sources --------------------------------- */

/** GET /sources — Prisma include `_count: { accounts, leads }`. */
export interface SourceItem {
  id: string;
  type: string;
  code: string;
  name: string;
  config?: Record<string, unknown> | null;
  createdAt: string;
  _count?: { accounts: number; leads: number };
}

/** GET/POST /sources/:id/accounts — the server adds `webhookUrl` to each row. */
export interface SourceAccount {
  id: string;
  name: string;
  publicId: string;
  config?: Record<string, unknown> | null;
  webhookUrl: string;
  createdAt: string;
  /** Metadata flag only: a signing secret exists. The value itself is never returned by GETs. */
  hasSigningSecret?: boolean;
  /** Present exactly once, on create or secret rotation. Never retrievable again. */
  signingSecret?: string;
}

/* ------------------------------- destinations ------------------------------ */

export interface DestinationHealth {
  status: string;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  lastError?: string | null;
  lastLatencyMs?: number | null;
  checkedAt?: string | null;
}

/** GET /destinations — Prisma include `health` + `_count: {deliveries, fieldMappings}`. */
export interface DestinationItem {
  id: string;
  type: string;
  name: string;
  status: "ACTIVE" | "DISABLED";
  config?: Record<string, unknown> | null;
  rateLimitPerSec?: number | null;
  createdAt: string;
  health?: DestinationHealth | null;
  _count?: { deliveries: number; fieldMappings: number };
}

/** GET /destinations/types — config keys each adapter actually requires. */
export interface DestinationTypeInfo {
  type: string;
  requiredConfigKeys: string[];
}

export interface DestinationTestResult {
  ok: boolean;
  status?: string | number | null;
  latencyMs?: number | null;
  error?: string | null;
  detail?: string | null;
}

/* ------------------------------- routing rules ----------------------------- */

export interface RuleCondition {
  field: string;
  operator: string;
  value?: string | number | boolean | string[] | null;
}

export interface RoutingRule {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  priority: number;
  stopOnMatch: boolean;
  conditions: RuleCondition[];
  version?: number;
  updatedAt: string;
  destinations: { id: string; name: string; type: string; order?: number }[];
}

/* ------------------------------- field mappings ---------------------------- */

export interface FieldMappingField {
  source: string;
  target: string;
  required?: boolean;
  defaultValue?: string | number | boolean;
  transforms?: unknown[];
}

export interface FieldMappingVersion {
  id: string;
  version: number;
  fields: FieldMappingField[];
  notes?: string | null;
  createdBy?: string | null;
  createdAt: string;
}

export interface FieldMappingListItem {
  id: string;
  name: string;
  destinationId: string;
  status: FieldMappingStatus;
  activeVersionId?: string | null;
  versionCount: number;
  destination: { id: string; name: string; type: string };
  updatedAt: string;
}

export interface FieldMappingDetail extends FieldMappingListItem {
  versions: FieldMappingVersion[];
}

/* --------------------------------- automation ------------------------------ */

export interface ScoringRule {
  id: string;
  label: string;
  condition: RuleCondition;
  points: number;
}

export interface ScoringRuleSet {
  id: string;
  name: string;
  /** Immutable label like "v1" (a new version is appended per create). */
  version: string;
  enabled: boolean;
  /** Stored as JSON — normalize before rendering. */
  rules: ScoringRule[];
  activatedAt?: string | null;
  createdAt: string;
}

export interface DedupConfig {
  id?: string;
  enabled: boolean;
  strategy: string;
  matchFields: string[];
  updatedAt?: string;
}

export interface EnrichmentStatus {
  implemented: boolean;
  providers: string[];
  note?: string;
}

/* -------------------------------- deliveries ------------------------------- */

export interface DeliveryListItem {
  id: string;
  leadId: string;
  /** List rows expose the lead id + intake time only. */
  lead?: { id: string; receivedAt?: string | null };
  destination: { id: string; name: string; type: string };
  status: DeliveryStatus;
  attemptCount: number;
  maxAttempts: number;
  /** Replay semantics (Phase 2): global counter + current cycle start. */
  replayCount?: number;
  cycleStartAttempt?: number;
  externalId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  correlationId?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Prisma `_count.attempts` — attempt rows fetched with the list. */
  _count?: { attempts: number };
}

export type DeliveryListPage = CursorPage<DeliveryListItem>;

export interface DeliveryDetail extends DeliveryListItem {
  attempts: DeliveryAttempt[];
}

/** GET /deliveries/queue-stats — real BullMQ counts (per-queue errors verbatim). */
export interface QueueStats {
  queues: Record<string, Record<string, number> | { error: string }>;
  deadLetters: Record<string, Record<string, number> | { error: string }>;
}

/* -------------------------------- audit logs ------------------------------- */

export interface AuditLogItem {
  id: string;
  actorType: string;
  actorId?: string | null;
  actorLabel?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  ip?: string | null;
  correlationId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  createdAt: string;
}

/* ---------------------------- users / roles / keys ------------------------- */

export interface UserListItem {
  id: string;
  email: string;
  name?: string | null;
  status: string;
  lastLoginAt?: string | null;
  createdAt: string;
  role: { id: string; name: string };
}

export interface RolePermissionsResult {
  items: string[];
  templates: Record<string, { description: string; permissions: string[] }>;
}

export interface RoleListItem {
  id: string;
  name: string;
  description?: string | null;
  permissions: string[];
  isSystem: boolean;
  createdAt: string;
  /** Members currently assigned to this role (API `toListItem`). */
  userCount: number;
}

export interface ApiKeyListItem {
  id: string;
  name: string;
  keyPrefix: string;
  status: string;
  scopes?: string[];
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
}

export interface ApiKeyCreated extends ApiKeyListItem {
  apiKey: string;
}

/* ---------------------------------- health --------------------------------- */

export interface HealthResult {
  status: "ok" | "degraded";
  checks: Record<string, { ok: boolean; latencyMs?: number | null; error?: string | null }>;
  version?: string;
  uptimeSec?: number;
}
