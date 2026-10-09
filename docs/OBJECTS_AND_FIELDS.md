# Middleware — Object & Field Inventory

Complete inventory of the database model and the application-layer objects of the
**Lead Integration & Distribution Middleware** project, derived from the actual
source rather than from assumptions.

> **Scope:** documentation only. No schema, migration, or runtime code was changed
> to produce this file.

---

## 1. Headline totals

| # | Item | Count | How verified |
|---|---|---|---|
| 1 | **Prisma models** | **29** | `model` declarations in `prisma/schema.prisma` |
| 2 | **Prisma enums** | **21** | `enum` declarations in `prisma/schema.prisma` |
| 3 | **Enum values (total)** | **111** | sum of all members across the 21 enums |
| 4 | **Database tables (application)** | **29** | `information_schema.tables` in schema `public`, excluding `_prisma_migrations` |
| 5 | **Database tables (incl. Prisma bookkeeping)** | **30** | 29 model tables + `_prisma_migrations` |
| 6 | **Application table columns** | **278** | `information_schema.columns`, excluding `_prisma_migrations` |
| 7 | **Total Prisma field declarations** | **338** | = 278 scalar columns + 60 relation fields |
| 8 | **Relation fields (incl. back-relations)** | **60** | fields whose type is another model |
| 9 | **Foreign-key columns** | part of the 278 | scalar fields consumed by `@relation(fields: …)` |
| 10 | **Unique constraints** | **22** | 13 `@@unique` + 9 field-level `@unique` |
| 11 | **Index declarations** | **44** | `@@index` blocks (composite indexes counted once) |
| 12 | **Primary keys** | **29** | one `@id` per model |
| 13 | **JSON fields** | **27** | fields of type `Json` |

**Cross-check that proves the counts line up:** 338 Prisma field declarations − 60
relation fields = **278**, which equals the **278** application columns reported by
`information_schema`. The model layer and the physical database agree exactly.

---

## 2. Verification performed

| Check | Command / method | Result |
|---|---|---|
| Schema syntactically valid | `npx prisma validate` | ✅ "The schema at prisma\schema.prisma is valid 🚀" |
| Migration history applied | `npx prisma migrate status` | ✅ "4 migrations found… Database schema is up to date!" |
| **Schema ↔ database drift** | `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code --script` | ✅ `-- This is an empty migration.` exit **0** → **no drift** |
| Table count | `information_schema.tables` (`public`, base tables) | 30 rows (29 models + `_prisma_migrations`) |
| Column count | `information_schema.columns` | 286 total / **278** excluding `_prisma_migrations` |
| Model & enum counts | parsed `prisma/schema.prisma` | 29 models / 21 enums |
| Field arithmetic | 338 total − 60 relations = 278 | matches DB columns exactly |
| Enum usage | every enum checked against model field types | 20 of 21 used; `RuleOperator` unused (see §9) |
| Enum drift vs TypeScript | compared `packages/types/src/enums.ts` against schema | superset drift on `RuleOperator` (see §9) |

**Migrations inspected:** `prisma/migrations/`

- `20260930102343_init` — initial tables, columns, FKs, indexes, uniques
- `20261001064433_delivery_replay_cycle` — delivery replay-cycle columns
- `20261005000000_single_application_identity` — removed tenant scoping (`tenantId` columns/keys/indexes)
- `20261006100000_business_lead_id` — business `leadId` column

---

## 3. Reading the field tables

Each model table below lists **every field without omission**:

| Column | Meaning |
|---|---|
| **Type** | exact Prisma type (`?` = nullable, `[]` = list) |
| **Req/Opt** | `req` = required, `opt` = nullable, `list` = scalar list |
| **Default** | `@default(...)` value as written in the schema |
| **PK** | `@id` primary key |
| **Uniq/Idx** | field-level `@unique`, plus `@@unique[...]` / `@@index[...]` blocks containing this field |
| **Relation** | `→ Model (FK fkField → refField, onDelete)`; "back-relation" = the other side of a relation declared elsewhere |

No model declares `tenantId`: after `20261005000000_single_application_identity`
this is a **single-application** schema (one row-set owns the whole application).

## 4. Complete model-by-model field inventory

29 models. Every field of every model is listed — including primary keys,
internal ids, timestamps, foreign keys, JSON columns and list columns.

#### Tenant

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `name` | `String` | req | — | — | — | — |
| 3 | `slug` | `String` | req | — | — | @unique | — |
| 4 | `status` | `TenantStatus` | req | `ACTIVE` | — | @@index[status] | — |
| 5 | `createdAt` | `DateTime` | req | `now()` | — | — | — |
| 6 | `updatedAt` | `DateTime` | req | — | — | — | — |

#### User

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `email` | `String` | req | — | — | @@unique[email] | — |
| 3 | `passwordHash` | `String` | req | — | — | — | — |
| 4 | `name` | `String` | req | — | — | — | — |
| 5 | `status` | `UserStatus` | req | `ACTIVE` | — | @@index[status] | — |
| 6 | `lastLoginAt` | `DateTime?` | opt | — | — | — | — |
| 7 | `createdAt` | `DateTime` | req | `now()` | — | — | — |
| 8 | `updatedAt` | `DateTime` | req | — | — | — | — |
| 9 | `roleId` | `String` | req | — | — | @@index[roleId] | — |
| 10 | `role` | `Role` | req | — | — | — | → Role (FK `roleId` → id, Restrict) |
| 11 | `sessions` | `UserSession[]` | list | — | — | — | → UserSession (back-relation) |
| 12 | `apiKeys` | `ApiKey[]` | list | — | — | — | → ApiKey (back-relation) |
| 13 | `auditLogs` | `AuditLog[]` | list | — | — | — | → AuditLog (back-relation) |

#### Role

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `name` | `String` | req | — | — | @@unique[name] | — |
| 3 | `description` | `String?` | opt | — | — | — | — |
| 4 | `isSystem` | `Boolean` | req | `false` | — | — | — |
| 5 | `permissions` | `String[]` | list | — | — | — | — |
| 6 | `createdAt` | `DateTime` | req | `now()` | — | — | — |
| 7 | `updatedAt` | `DateTime` | req | — | — | — | — |
| 8 | `users` | `User[]` | list | — | — | — | → User (back-relation) |

#### UserSession

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `userId` | `String` | req | — | — | @@index[userId] | — |
| 3 | `refreshTokenHash` | `String` | req | — | — | @unique | — |
| 4 | `expiresAt` | `DateTime` | req | — | — | @@index[expiresAt] | — |
| 5 | `revokedAt` | `DateTime?` | opt | — | — | — | — |
| 6 | `ip` | `String?` | opt | — | — | — | — |
| 7 | `userAgent` | `String?` | opt | — | — | — | — |
| 8 | `createdAt` | `DateTime` | req | `now()` | — | — | — |
| 9 | `user` | `User` | req | — | — | — | → User (FK `userId` → id, Cascade) |

#### ApiKey

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `userId` | `String` | req | — | — | — | — |
| 3 | `name` | `String` | req | — | — | — | — |
| 4 | `keyPrefix` | `String` | req | — | — | — | — |
| 5 | `keyHash` | `String` | req | — | — | @unique | — |
| 6 | `status` | `ApiKeyStatus` | req | `ACTIVE` | — | @@index[status] | — |
| 7 | `scopes` | `String[]` | list | — | — | — | — |
| 8 | `lastUsedAt` | `DateTime?` | opt | — | — | — | — |
| 9 | `expiresAt` | `DateTime?` | opt | — | — | — | — |
| 10 | `revokedAt` | `DateTime?` | opt | — | — | — | — |
| 11 | `createdAt` | `DateTime` | req | `now()` | — | @@index[createdAt] | — |
| 12 | `user` | `User` | req | — | — | — | → User (FK `userId` → id, Cascade) |

#### LeadSource

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `type` | `SourceType` | req | — | — | @@index[type] | — |
| 3 | `code` | `String` | req | — | — | @@unique[code] | — |
| 4 | `name` | `String` | req | — | — | — | — |
| 5 | `config` | `Json` | req | `"{}"` | — | — | — |
| 6 | `createdAt` | `DateTime` | req | `now()` | — | — | — |
| 7 | `updatedAt` | `DateTime` | req | — | — | — | — |
| 8 | `accounts` | `LeadSourceAccount[]` | list | — | — | — | → LeadSourceAccount (back-relation) |
| 9 | `leads` | `Lead[]` | list | — | — | — | → Lead (back-relation) |
| 10 | `webhookEvents` | `WebhookEvent[]` | list | — | — | — | → WebhookEvent (back-relation) |
| 11 | `importJobs` | `ImportJob[]` | list | — | — | — | → ImportJob (back-relation) |

#### LeadSourceAccount

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `sourceId` | `String` | req | — | — | @@index[sourceId] | — |
| 3 | `name` | `String` | req | — | — | — | — |
| 4 | `publicId` | `String` | req | — | — | @unique | — |
| 5 | `config` | `Json` | req | `"{}"` | — | — | — |
| 6 | `createdAt` | `DateTime` | req | `now()` | — | — | — |
| 7 | `updatedAt` | `DateTime` | req | — | — | — | — |
| 8 | `source` | `LeadSource` | req | — | — | — | → LeadSource (FK `sourceId` → id, Cascade) |
| 9 | `credentials` | `IntegrationCredential[]` | list | — | — | — | → IntegrationCredential (back-relation) |
| 10 | `leads` | `Lead[]` | list | — | — | — | → Lead (back-relation) |
| 11 | `webhookEvents` | `WebhookEvent[]` | list | — | — | — | → WebhookEvent (back-relation) |
| 12 | `importJobs` | `ImportJob[]` | list | — | — | — | → ImportJob (back-relation) |

#### IntegrationCredential

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `type` | `CredentialType` | req | — | — | — | — |
| 3 | `sourceAccountId` | `String?` | opt | — | — | @@index[sourceAccountId] | — |
| 4 | `destinationId` | `String?` | opt | — | — | @@index[destinationId] | — |
| 5 | `secret` | `String` | req | — | — | — | — |
| 6 | `meta` | `Json` | req | `"{}"` | — | — | — |
| 7 | `createdAt` | `DateTime` | req | `now()` | — | — | — |
| 8 | `updatedAt` | `DateTime` | req | — | — | — | — |
| 9 | `rotatedAt` | `DateTime?` | opt | — | — | — | — |
| 10 | `sourceAccount` | `LeadSourceAccount?` | opt | — | — | — | → LeadSourceAccount (FK `sourceAccountId` → id, Cascade) |
| 11 | `destination` | `Destination?` | opt | — | — | — | → Destination (FK `destinationId` → id, Cascade) |

#### Lead

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `leadId` | `String` | req | `dbgenerated()` | — | @unique | — |
| 3 | `sourceId` | `String` | req | — | — | @@index[sourceId,createdAt] | — |
| 4 | `sourceAccountId` | `String` | req | — | — | @@unique[sourceAccountId,externalLeadId] | — |
| 5 | `externalLeadId` | `String?` | opt | — | — | @@unique[sourceAccountId,externalLeadId] | — |
| 6 | `status` | `LeadStatus` | req | `RECEIVED` | — | @@index[status,createdAt] | — |
| 7 | `stage` | `LeadStage` | req | `RECEIVED` | — | — | — |
| 8 | `canonicalData` | `Json` | req | `"{}"` | — | — | — |
| 9 | `normalizedData` | `Json?` | opt | — | — | — | — |
| 10 | `dedupPhoneHash` | `String?` | opt | — | — | @@index[dedupPhoneHash] | — |
| 11 | `dedupEmailHash` | `String?` | opt | — | — | @@index[dedupEmailHash] | — |
| 12 | `score` | `Int?` | opt | — | — | — | — |
| 13 | `scoreVersion` | `String?` | opt | — | — | — | — |
| 14 | `correlationId` | `String?` | opt | — | — | @@index[correlationId] | — |
| 15 | `receivedAt` | `DateTime` | req | `now()` | — | — | — |
| 16 | `createdAt` | `DateTime` | req | `now()` | — | @@index[createdAt]; @@index[status,createdAt]; @@index[sourceId,createdAt] | — |
| 17 | `updatedAt` | `DateTime` | req | — | — | — | — |
| 18 | `source` | `LeadSource` | req | — | — | — | → LeadSource (FK `sourceId` → id, Restrict) |
| 19 | `sourceAccount` | `LeadSourceAccount` | req | — | — | — | → LeadSourceAccount (FK `sourceAccountId` → id, Restrict) |
| 20 | `rawPayloads` | `LeadRawPayload[]` | list | — | — | — | → LeadRawPayload (back-relation) |
| 21 | `processing` | `LeadProcessing?` | opt | — | — | — | → LeadProcessing (back-relation) |
| 22 | `stageEvents` | `LeadStageEvent[]` | list | — | — | — | → LeadStageEvent (back-relation) |
| 23 | `scores` | `LeadScore[]` | list | — | — | — | → LeadScore (back-relation) |
| 24 | `duplicateOf` | `LeadDuplicate?` | opt | — | — | — | → LeadDuplicate (FK `` → ) |
| 25 | `duplicates` | `LeadDuplicate[]` | list | — | — | — | → LeadDuplicate (FK `` → ) |
| 26 | `routingResults` | `RoutingResult[]` | list | — | — | — | → RoutingResult (back-relation) |
| 27 | `deliveries` | `Delivery[]` | list | — | — | — | → Delivery (back-relation) |
| 28 | `webhookEvents` | `WebhookEvent[]` | list | — | — | — | → WebhookEvent (back-relation) |

#### LeadRawPayload

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `leadId` | `String` | req | — | — | @@index[leadId] | — |
| 3 | `sourceAccountId` | `String?` | opt | — | — | — | — |
| 4 | `payload` | `Json` | req | — | — | — | — |
| 5 | `headers` | `Json?` | opt | — | — | — | — |
| 6 | `contentType` | `String?` | opt | — | — | — | — |
| 7 | `checksum` | `String` | req | — | — | — | — |
| 8 | `receivedAt` | `DateTime` | req | `now()` | — | @@index[receivedAt] | — |
| 9 | `lead` | `Lead` | req | — | — | — | → Lead (FK `leadId` → id, Cascade) |

#### LeadProcessing

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `leadId` | `String` | req | — | — | @unique | — |
| 3 | `validationStatus` | `ValidationStatus` | req | `PENDING` | — | @@index[validationStatus] | — |
| 4 | `deduplicationStatus` | `DeduplicationStatus` | req | `PENDING` | — | — | — |
| 5 | `validationResult` | `Json?` | opt | — | — | — | — |
| 6 | `normalizationResult` | `Json?` | opt | — | — | — | — |
| 7 | `deduplicationResult` | `Json?` | opt | — | — | — | — |
| 8 | `enrichmentResult` | `Json?` | opt | — | — | — | — |
| 9 | `routingResult` | `Json?` | opt | — | — | — | — |
| 10 | `correlationId` | `String?` | opt | — | — | — | — |
| 11 | `startedAt` | `DateTime` | req | `now()` | — | — | — |
| 12 | `finishedAt` | `DateTime?` | opt | — | — | — | — |
| 13 | `error` | `String?` | opt | — | — | — | — |
| 14 | `updatedAt` | `DateTime` | req | — | — | — | — |
| 15 | `lead` | `Lead` | req | — | — | — | → Lead (FK `leadId` → id, Cascade) |

#### LeadStageEvent

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `leadId` | `String` | req | — | — | @@index[leadId,startedAt] | — |
| 3 | `stage` | `LeadStage` | req | — | — | @@index[stage,startedAt] | — |
| 4 | `status` | `StageStatus` | req | — | — | — | — |
| 5 | `startedAt` | `DateTime` | req | `now()` | — | @@index[leadId,startedAt]; @@index[stage,startedAt] | — |
| 6 | `finishedAt` | `DateTime?` | opt | — | — | — | — |
| 7 | `durationMs` | `Int?` | opt | — | — | — | — |
| 8 | `detail` | `Json?` | opt | — | — | — | — |
| 9 | `error` | `String?` | opt | — | — | — | — |
| 10 | `correlationId` | `String?` | opt | — | — | — | — |
| 11 | `lead` | `Lead` | req | — | — | — | → Lead (FK `leadId` → id, Cascade) |

#### LeadScore

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `leadId` | `String` | req | — | — | @@unique[leadId,version] | — |
| 3 | `score` | `Int` | req | — | — | — | — |
| 4 | `version` | `String` | req | — | — | @@unique[leadId,version] | — |
| 5 | `breakdown` | `Json` | req | `"[]"` | — | — | — |
| 6 | `computedAt` | `DateTime` | req | `now()` | — | @@index[computedAt] | — |
| 7 | `lead` | `Lead` | req | — | — | — | → Lead (FK `leadId` → id, Cascade) |

#### LeadDuplicate

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `leadId` | `String` | req | — | — | @unique | — |
| 3 | `originalLeadId` | `String` | req | — | — | @@index[originalLeadId] | — |
| 4 | `strategy` | `MatchedField` | req | — | — | — | — |
| 5 | `matchedHash` | `String?` | opt | — | — | — | — |
| 6 | `confidence` | `Float` | req | `1.0` | — | — | — |
| 7 | `createdAt` | `DateTime` | req | `now()` | — | @@index[createdAt] | — |
| 8 | `lead` | `Lead` | req | — | — | — | → Lead (FK `leadId` → id, Cascade) |
| 9 | `original` | `Lead` | req | — | — | — | → Lead (FK `originalLeadId` → id, Cascade) |

#### WebhookEvent

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `sourceAccountId` | `String` | req | — | — | @@unique[sourceAccountId,idempotencyKey] | — |
| 3 | `sourceId` | `String?` | opt | — | — | — | — |
| 4 | `externalEventId` | `String?` | opt | — | — | — | — |
| 5 | `status` | `WebhookEventStatus` | req | `RECEIVED` | — | @@index[status,receivedAt] | — |
| 6 | `idempotencyKey` | `String` | req | — | — | @@unique[sourceAccountId,idempotencyKey] | — |
| 7 | `headers` | `Json?` | opt | — | — | — | — |
| 8 | `payload` | `Json` | req | — | — | — | — |
| 9 | `leadId` | `String?` | opt | — | — | — | — |
| 10 | `error` | `String?` | opt | — | — | — | — |
| 11 | `receivedAt` | `DateTime` | req | `now()` | — | @@index[receivedAt]; @@index[status,receivedAt] | — |
| 12 | `processedAt` | `DateTime?` | opt | — | — | — | — |
| 13 | `sourceAccount` | `LeadSourceAccount` | req | — | — | — | → LeadSourceAccount (FK `sourceAccountId` → id, Cascade) |
| 14 | `source` | `LeadSource?` | opt | — | — | — | → LeadSource (FK `sourceId` → id, SetNull) |
| 15 | `lead` | `Lead?` | opt | — | — | — | → Lead (FK `leadId` → id, SetNull) |

#### RoutingRule

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `name` | `String` | req | — | — | — | — |
| 3 | `description` | `String?` | opt | — | — | — | — |
| 4 | `enabled` | `Boolean` | req | `true` | — | @@index[enabled,priority] | — |
| 5 | `priority` | `Int` | req | `100` | — | @@index[enabled,priority] | — |
| 6 | `conditions` | `Json` | req | `"[]"` | — | — | — |
| 7 | `stopOnMatch` | `Boolean` | req | `true` | — | — | — |
| 8 | `version` | `Int` | req | `1` | — | — | — |
| 9 | `createdAt` | `DateTime` | req | `now()` | — | — | — |
| 10 | `updatedAt` | `DateTime` | req | — | — | — | — |
| 11 | `destinations` | `RoutingRuleDestination[]` | list | — | — | — | → RoutingRuleDestination (back-relation) |

#### RoutingRuleDestination

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `ruleId` | `String` | req | — | — | @@unique[ruleId,destinationId] | — |
| 3 | `destinationId` | `String` | req | — | — | @@unique[ruleId,destinationId]; @@index[destinationId] | — |
| 4 | `order` | `Int` | req | `0` | — | — | — |
| 5 | `rule` | `RoutingRule` | req | — | — | — | → RoutingRule (FK `ruleId` → id, Cascade) |
| 6 | `destination` | `Destination` | req | — | — | — | → Destination (FK `destinationId` → id, Cascade) |

#### RoutingResult

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `leadId` | `String` | req | — | — | @@index[leadId,evaluatedAt] | — |
| 3 | `ruleId` | `String?` | opt | — | — | — | — |
| 4 | `destinationIds` | `Json` | req | `"[]"` | — | — | — |
| 5 | `matched` | `Boolean` | req | `false` | — | — | — |
| 6 | `reason` | `String?` | opt | — | — | — | — |
| 7 | `evaluatedAt` | `DateTime` | req | `now()` | — | @@index[leadId,evaluatedAt] | — |
| 8 | `lead` | `Lead` | req | — | — | — | → Lead (FK `leadId` → id, Cascade) |

#### FieldMapping

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `destinationId` | `String` | req | — | — | @@unique[destinationId,name] | — |
| 3 | `name` | `String` | req | — | — | @@unique[destinationId,name] | — |
| 4 | `status` | `FieldMappingStatus` | req | `DRAFT` | — | @@index[status] | — |
| 5 | `activeVersionId` | `String?` | opt | — | — | — | — |
| 6 | `createdAt` | `DateTime` | req | `now()` | — | — | — |
| 7 | `updatedAt` | `DateTime` | req | — | — | — | — |
| 8 | `destination` | `Destination` | req | — | — | — | → Destination (FK `destinationId` → id, Cascade) |
| 9 | `versions` | `FieldMappingVersion[]` | list | — | — | — | → FieldMappingVersion (back-relation) |

#### FieldMappingVersion

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `mappingId` | `String` | req | — | — | @@unique[mappingId,version] | — |
| 3 | `version` | `Int` | req | — | — | @@unique[mappingId,version] | — |
| 4 | `fields` | `Json` | req | `"[]"` | — | — | — |
| 5 | `notes` | `String?` | opt | — | — | — | — |
| 6 | `createdBy` | `String?` | opt | — | — | — | — |
| 7 | `createdAt` | `DateTime` | req | `now()` | — | — | — |
| 8 | `mapping` | `FieldMapping` | req | — | — | — | → FieldMapping (FK `mappingId` → id, Cascade) |

#### Destination

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `type` | `DestinationType` | req | — | — | @@index[type,status] | — |
| 3 | `name` | `String` | req | — | — | @@unique[name] | — |
| 4 | `status` | `DestinationStatus` | req | `ACTIVE` | — | @@index[type,status] | — |
| 5 | `config` | `Json` | req | `"{}"` | — | — | — |
| 6 | `rateLimitPerSec` | `Int?` | opt | — | — | — | — |
| 7 | `createdAt` | `DateTime` | req | `now()` | — | — | — |
| 8 | `updatedAt` | `DateTime` | req | — | — | — | — |
| 9 | `health` | `DestinationHealth?` | opt | — | — | — | → DestinationHealth (back-relation) |
| 10 | `credentials` | `IntegrationCredential[]` | list | — | — | — | → IntegrationCredential (back-relation) |
| 11 | `deliveries` | `Delivery[]` | list | — | — | — | → Delivery (back-relation) |
| 12 | `ruleTargets` | `RoutingRuleDestination[]` | list | — | — | — | → RoutingRuleDestination (back-relation) |
| 13 | `fieldMappings` | `FieldMapping[]` | list | — | — | — | → FieldMapping (back-relation) |

#### DestinationHealth

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `destinationId` | `String` | req | — | — | @unique | — |
| 3 | `status` | `ConnectionStatus` | req | `NOT_CONFIGURED` | — | — | — |
| 4 | `lastSuccessAt` | `DateTime?` | opt | — | — | — | — |
| 5 | `lastFailureAt` | `DateTime?` | opt | — | — | — | — |
| 6 | `lastError` | `String?` | opt | — | — | — | — |
| 7 | `lastLatencyMs` | `Int?` | opt | — | — | — | — |
| 8 | `checkedAt` | `DateTime?` | opt | — | — | — | — |
| 9 | `updatedAt` | `DateTime` | req | — | — | — | — |
| 10 | `destination` | `Destination` | req | — | — | — | → Destination (FK `destinationId` → id, Cascade) |

#### Delivery

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `leadId` | `String` | req | — | — | @@unique[leadId,destinationId] | — |
| 3 | `destinationId` | `String` | req | — | — | @@unique[leadId,destinationId]; @@index[destinationId,status] | — |
| 4 | `status` | `DeliveryStatus` | req | `PENDING` | — | @@index[status,updatedAt]; @@index[destinationId,status]; @@index[status,nextAttemptAt] | — |
| 5 | `attemptCount` | `Int` | req | `0` | — | — | — |
| 6 | `maxAttempts` | `Int` | req | `5` | — | — | — |
| 7 | `replayCount` | `Int` | req | `0` | — | — | — |
| 8 | `cycleStartAttempt` | `Int` | req | `1` | — | — | — |
| 9 | `nextAttemptAt` | `DateTime?` | opt | — | — | @@index[status,nextAttemptAt] | — |
| 10 | `mappedPayload` | `Json?` | opt | — | — | — | — |
| 11 | `externalId` | `String?` | opt | — | — | — | — |
| 12 | `correlationId` | `String?` | opt | — | — | — | — |
| 13 | `errorCode` | `String?` | opt | — | — | — | — |
| 14 | `errorMessage` | `String?` | opt | — | — | — | — |
| 15 | `enqueuedAt` | `DateTime?` | opt | — | — | — | — |
| 16 | `completedAt` | `DateTime?` | opt | — | — | — | — |
| 17 | `createdAt` | `DateTime` | req | `now()` | — | — | — |
| 18 | `updatedAt` | `DateTime` | req | — | — | @@index[status,updatedAt] | — |
| 19 | `lead` | `Lead` | req | — | — | — | → Lead (FK `leadId` → id, Cascade) |
| 20 | `destination` | `Destination` | req | — | — | — | → Destination (FK `destinationId` → id, Cascade) |
| 21 | `attempts` | `DeliveryAttempt[]` | list | — | — | — | → DeliveryAttempt (back-relation) |

#### DeliveryAttempt

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `deliveryId` | `String` | req | — | — | @@unique[deliveryId,attemptNumber] | — |
| 3 | `attemptNumber` | `Int` | req | — | — | @@unique[deliveryId,attemptNumber] | — |
| 4 | `replayCycle` | `Int` | req | `0` | — | — | — |
| 5 | `status` | `DeliveryAttemptStatus` | req | — | — | @@index[status] | — |
| 6 | `responseStatus` | `Int?` | opt | — | — | — | — |
| 7 | `responseBody` | `String?` | opt | — | — | — | — |
| 8 | `errorCode` | `String?` | opt | — | — | — | — |
| 9 | `errorCategory` | `String?` | opt | — | — | — | — |
| 10 | `durationMs` | `Int?` | opt | — | — | — | — |
| 11 | `externalId` | `String?` | opt | — | — | — | — |
| 12 | `requestMeta` | `Json?` | opt | — | — | — | — |
| 13 | `startedAt` | `DateTime` | req | `now()` | — | @@index[startedAt] | — |
| 14 | `finishedAt` | `DateTime?` | opt | — | — | — | — |
| 15 | `workerId` | `String?` | opt | — | — | — | — |
| 16 | `delivery` | `Delivery` | req | — | — | — | → Delivery (FK `deliveryId` → id, Cascade) |

#### ImportJob

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `sourceId` | `String?` | opt | — | — | — | — |
| 3 | `sourceAccountId` | `String?` | opt | — | — | — | — |
| 4 | `fileName` | `String` | req | — | — | — | — |
| 5 | `fileSizeBytes` | `Int` | req | — | — | — | — |
| 6 | `checksum` | `String` | req | — | — | — | — |
| 7 | `storageKey` | `String` | req | — | — | — | — |
| 8 | `status` | `ImportJobStatus` | req | `PENDING` | — | @@index[status,createdAt] | — |
| 9 | `totalRows` | `Int?` | opt | — | — | — | — |
| 10 | `processedRows` | `Int` | req | `0` | — | — | — |
| 11 | `successfulRows` | `Int` | req | `0` | — | — | — |
| 12 | `failedRows` | `Int` | req | `0` | — | — | — |
| 13 | `duplicateRows` | `Int` | req | `0` | — | — | — |
| 14 | `errorReportKey` | `String?` | opt | — | — | — | — |
| 15 | `correlationId` | `String?` | opt | — | — | — | — |
| 16 | `createdBy` | `String?` | opt | — | — | — | — |
| 17 | `createdAt` | `DateTime` | req | `now()` | — | @@index[status,createdAt]; @@index[createdAt] | — |
| 18 | `startedAt` | `DateTime?` | opt | — | — | — | — |
| 19 | `finishedAt` | `DateTime?` | opt | — | — | — | — |
| 20 | `error` | `String?` | opt | — | — | — | — |
| 21 | `source` | `LeadSource?` | opt | — | — | — | → LeadSource (FK `sourceId` → id, SetNull) |
| 22 | `sourceAccount` | `LeadSourceAccount?` | opt | — | — | — | → LeadSourceAccount (FK `sourceAccountId` → id, SetNull) |
| 23 | `rowErrors` | `ImportRowError[]` | list | — | — | — | → ImportRowError (back-relation) |

#### ImportRowError

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `importJobId` | `String` | req | — | — | @@index[importJobId] | — |
| 3 | `rowNumber` | `Int` | req | — | — | — | — |
| 4 | `rawRow` | `Json` | req | — | — | — | — |
| 5 | `error` | `String` | req | — | — | — | — |
| 6 | `createdAt` | `DateTime` | req | `now()` | — | — | — |
| 7 | `importJob` | `ImportJob` | req | — | — | — | → ImportJob (FK `importJobId` → id, Cascade) |

#### DeduplicationConfig

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `instanceKey` | `String` | req | `"default"` | — | @unique | — |
| 3 | `enabled` | `Boolean` | req | `false` | — | — | — |
| 4 | `strategy` | `MatchedField` | req | `PHONE` | — | — | — |
| 5 | `matchFields` | `String[]` | list | `[]` | — | — | — |
| 6 | `updatedAt` | `DateTime` | req | — | — | — | — |
| 7 | `createdAt` | `DateTime` | req | `now()` | — | — | — |

#### ScoringRuleSet

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `name` | `String` | req | — | — | — | — |
| 3 | `version` | `String` | req | — | — | @@unique[version] | — |
| 4 | `enabled` | `Boolean` | req | `false` | — | @@index[enabled] | — |
| 5 | `rules` | `Json` | req | `"[]"` | — | — | — |
| 6 | `activatedAt` | `DateTime?` | opt | — | — | — | — |
| 7 | `createdAt` | `DateTime` | req | `now()` | — | — | — |
| 8 | `updatedAt` | `DateTime` | req | — | — | — | — |

#### AuditLog

| # | Field | Type | Req/Opt | Default | PK | Uniq/Idx | Relation |
|---|---|---|---|---|---|---|---|
| 1 | `id` | `String` | req | `cuid()` | PK | — | — |
| 2 | `actorType` | `AuditActorType` | req | — | — | — | — |
| 3 | `actorId` | `String?` | opt | — | — | @@index[actorId,createdAt] | — |
| 4 | `actorLabel` | `String?` | opt | — | — | — | — |
| 5 | `action` | `String` | req | — | — | — | — |
| 6 | `entityType` | `String` | req | — | — | @@index[entityType,entityId] | — |
| 7 | `entityId` | `String?` | opt | — | — | @@index[entityType,entityId] | — |
| 8 | `ip` | `String?` | opt | — | — | — | — |
| 9 | `userAgent` | `String?` | opt | — | — | — | — |
| 10 | `correlationId` | `String?` | opt | — | — | — | — |
| 11 | `before` | `Json?` | opt | — | — | — | — |
| 12 | `after` | `Json?` | opt | — | — | — | — |
| 13 | `metadata` | `Json?` | opt | — | — | — | — |
| 14 | `createdAt` | `DateTime` | req | `now()` | — | @@index[createdAt]; @@index[actorId,createdAt] | — |
| 15 | `actor` | `User?` | opt | — | — | — | → User (FK `actorId` → id, SetNull) |

---

## 5. Relationships and cardinalities

**30 foreign keys** exist (fields declared with `@relation(fields: …, references: …)`).
Combined with named back-relations and plain back-relation fields, the model layer
declares **60 relation fields** in total.

### 5.1 Foreign-key relations (the enforced side)

| Parent | Child | FK column | Cardinality | onDelete |
|---|---|---|---|---|
| `Role` | `User` | `User.roleId` | 1 : N | **Restrict** |
| `User` | `UserSession` | `UserSession.userId` | 1 : N | Cascade |
| `User` | `ApiKey` | `ApiKey.userId` | 1 : N | Cascade |
| `User` | `AuditLog` | `AuditLog.actorId` | 1 : N (nullable) | SetNull |
| `LeadSource` | `LeadSourceAccount` | `LeadSourceAccount.sourceId` | 1 : N | Cascade |
| `LeadSource` | `Lead` | `Lead.sourceId` | 1 : N | **Restrict** |
| `LeadSource` | `WebhookEvent` | `WebhookEvent.sourceId` | 1 : N (nullable) | SetNull |
| `LeadSource` | `ImportJob` | `ImportJob.sourceId` | 1 : N (nullable) | SetNull |
| `LeadSourceAccount` | `IntegrationCredential` | `IntegrationCredential.sourceAccountId` | 1 : N (nullable) | Cascade |
| `LeadSourceAccount` | `Lead` | `Lead.sourceAccountId` | 1 : N | **Restrict** |
| `LeadSourceAccount` | `WebhookEvent` | `WebhookEvent.sourceAccountId` | 1 : N | Cascade |
| `LeadSourceAccount` | `ImportJob` | `ImportJob.sourceAccountId` | 1 : N (nullable) | SetNull |
| `Destination` | `IntegrationCredential` | `IntegrationCredential.destinationId` | 1 : N (nullable) | Cascade |
| `Destination` | `Delivery` | `Delivery.destinationId` | 1 : N | Cascade |
| `Destination` | `RoutingRuleDestination` | `RoutingRuleDestination.destinationId` | 1 : N | Cascade |
| `Destination` | `FieldMapping` | `FieldMapping.destinationId` | 1 : N | Cascade |
| `Destination` | `DestinationHealth` | `DestinationHealth.destinationId` | **1 : 1** (unique) | Cascade |
| `RoutingRule` | `RoutingRuleDestination` | `RoutingRuleDestination.ruleId` | 1 : N | Cascade |
| `Lead` | `LeadSource` / `LeadSourceAccount` | *(see above)* | N : 1 | Restrict |
| `Lead` | `LeadRawPayload` | `LeadRawPayload.leadId` | 1 : N | Cascade |
| `Lead` | `LeadProcessing` | `LeadProcessing.leadId` | **1 : 1** (unique) | Cascade |
| `Lead` | `LeadStageEvent` | `LeadStageEvent.leadId` | 1 : N | Cascade |
| `Lead` | `LeadScore` | `LeadScore.leadId` | 1 : N | Cascade |
| `Lead` | `RoutingResult` | `RoutingResult.leadId` | 1 : N | Cascade |
| `Lead` | `Delivery` | `Delivery.leadId` | 1 : N | Cascade |
| `Lead` | `WebhookEvent` | `WebhookEvent.leadId` | 1 : N (nullable) | SetNull |
| `Lead` *(duplicate)* | `LeadDuplicate` | `LeadDuplicate.leadId` | 1 : 1 (unique) | Cascade |
| `Lead` *(original)* | `LeadDuplicate` | `LeadDuplicate.originalLeadId` | 1 : N | Cascade |
| `WebhookEvent` | `LeadSourceAccount` | `WebhookEvent.sourceAccountId` | N : 1 | Cascade |
| `FieldMapping` | `FieldMappingVersion` | `FieldMappingVersion.mappingId` | 1 : N | Cascade |
| `Delivery` | `DeliveryAttempt` | `DeliveryAttempt.deliveryId` | 1 : N | Cascade |
| `ImportJob` | `ImportRowError` | `ImportRowError.importJobId` | 1 : N | Cascade |

### 5.2 Self-relation

`LeadDuplicate` is a **named self-relation on `Lead`** with two roles:

- role `LeadDuplicate` — `LeadDuplicate.leadId → Lead.id` → exposed as `Lead.duplicateOf`
  (the newer lead, flagged as duplicate), 1 : 1 because `leadId` is `@unique`.
- role `LeadOriginal` — `LeadDuplicate.originalLeadId → Lead.id` → exposed as
  `Lead.duplicates` (the earlier lead that has duplicates), 1 : N.

Duplicates are **linked, never deleted** (both FKs are `Cascade` on the row, not on
the leads — deleting a lead removes only the link rows).

### 5.3 Soft references (no foreign key — verified)

Two nullable `*Id` scalars are **not** backed by a Prisma relation, so the database
does **not** enforce referential integrity on them:

| Column | Intended target | Notes |
|---|---|---|
| `RoutingResult.ruleId` | `RoutingRule.id` | nullable; the rule may be deleted later and the result keeps its text id |
| `FieldMapping.activeVersionId` | `FieldMappingVersion.id` | nullable; points at the published version of the mapping |

Other non-FK id-like columns are by design, not references: correlation ids
(`Lead`, `LeadProcessing`, `Delivery`, `ImportJob`), ownership strings without FK
(`ImportJob.createdBy`, `FieldMappingVersion.createdBy`, `DeliveryAttempt.workerId`),
the polymorphic audit locator (`AuditLog.entityType` + `entityId`), and
destination-side record ids (`Delivery.externalId`, `DeliveryAttempt.externalId`).

### 5.4 Isolated model

`Tenant` has **no relation to or from any other model** — it is an orphaned leftover
of the former multi-tenant design (see §9).

---

## 6. Unique constraints and indexes

**22 unique constraints** and **44 index declarations**, **29 primary keys**.

### 6.1 Field-level `@unique` (9)

| Field | Purpose |
|---|---|
| `Tenant.slug` | tenant handle |
| `UserSession.refreshTokenHash` | SHA-256 of refresh token — lookup for rotation |
| `ApiKey.keyHash` | SHA-256 of the raw key — the key is only shown once at creation |
| `LeadSourceAccount.publicId` | public id embedded in inbound webhook URLs |
| `Lead.leadId` | business lead id (`LD-0000479` …) |
| `LeadProcessing.leadId` | enforces 1 : 1 with `Lead` |
| `LeadDuplicate.leadId` | a lead can be flagged duplicate at most once |
| `DestinationHealth.destinationId` | enforces 1 : 1 with `Destination` |
| `DeduplicationConfig.instanceKey` | singleton config row (default `"default"`) |

### 6.2 Composite `@@unique` (13)

| Model | Columns | Purpose |
|---|---|---|
| `User` | `[email]` | login identity |
| `Role` | `[name]` | role names |
| `LeadSource` | `[code]` | machine code |
| `Lead` | `[sourceAccountId, externalLeadId]` | **idempotency** — a re-sent lead can never create a second row |
| `LeadScore` | `[leadId, version]` | immutable score history per rule-set version |
| `WebhookEvent` | `[sourceAccountId, idempotencyKey]` | **database-level webhook idempotency** |
| `RoutingRuleDestination` | `[ruleId, destinationId]` | no duplicate destination on a rule |
| `FieldMapping` | `[destinationId, name]` | mapping names unique per destination |
| `FieldMappingVersion` | `[mappingId, version]` | monotonic versions |
| `Destination` | `[name]` | destination names |
| `Delivery` | `[leadId, destinationId]` | **exactly one delivery per (lead, destination)** |
| `DeliveryAttempt` | `[deliveryId, attemptNumber]` | replays never renumber history |
| `ScoringRuleSet` | `[version]` | versioned scoring rules |

### 6.3 Indexes (44 `@@index` blocks)

Listed with the fields they cover (see the per-model tables in §4 for placement):

`Tenant.status` · `User.status` · `User.roleId` · `Role` *(none)* ·
`UserSession.userId` · `UserSession.expiresAt` · `ApiKey.status` · `ApiKey.createdAt` ·
`LeadSource.type` · `LeadSourceAccount.sourceId` ·
`IntegrationCredential.sourceAccountId` · `IntegrationCredential.destinationId` ·
`Lead.createdAt` · `Lead.[status, createdAt]` · `Lead.[sourceId, createdAt]` ·
`Lead.dedupPhoneHash` · `Lead.dedupEmailHash` · `Lead.correlationId` ·
`LeadRawPayload.leadId` · `LeadRawPayload.receivedAt` · `LeadProcessing.validationStatus` ·
`LeadStageEvent.[leadId, startedAt]` · `LeadStageEvent.[stage, startedAt]` ·
`LeadScore.computedAt` · `LeadDuplicate.originalLeadId` · `LeadDuplicate.createdAt` ·
`WebhookEvent.receivedAt` · `WebhookEvent.[status, receivedAt]` ·
`RoutingRule.[enabled, priority]` · `RoutingRuleDestination.destinationId` ·
`RoutingResult.[leadId, evaluatedAt]` · `FieldMapping.status` ·
`Destination.[type, status]` · `Delivery.[status, updatedAt]` ·
`Delivery.[destinationId, status]` · `Delivery.[status, nextAttemptAt]` ·
`DeliveryAttempt.startedAt` · `DeliveryAttempt.status` ·
`ImportJob.[status, createdAt]` · `ImportJob.createdAt` · `ImportRowError.importJobId` ·
`ScoringRuleSet.enabled` · `AuditLog.createdAt` · `AuditLog.[entityType, entityId]` ·
`AuditLog.[actorId, createdAt]`

(`DeduplicationConfig` and `DestinationHealth` declare **no** extra index — both are
singleton/unique-key lookups already covered by `@unique`.)

---

## 7. JSON fields and their intended use (27)

| Field | Nullable | Intended use |
|---|---|---|
| `LeadSource.config` | no | non-secret source display/config (never credentials) |
| `LeadSourceAccount.config` | no | non-secret account metadata (ad account id, form id…) |
| `IntegrationCredential.meta` | no | non-secret metadata: key id, token endpoint, prefix, lastRotation |
| `Lead.canonicalData` | no | canonical normalized lead data — single source of truth downstream |
| `Lead.normalizedData` | yes | provider-specific pre-canonical view |
| `LeadRawPayload.payload` | no | **immutable** original inbound bytes |
| `LeadRawPayload.headers` | yes | sanitized inbound headers (secrets redacted) |
| `LeadProcessing.validationResult` | yes | stage outcome |
| `LeadProcessing.normalizationResult` | yes | stage outcome |
| `LeadProcessing.deduplicationResult` | yes | stage outcome |
| `LeadProcessing.enrichmentResult` | yes | stage outcome |
| `LeadProcessing.routingResult` | yes | stage outcome |
| `LeadStageEvent.detail` | yes | stage-specific detail for the pipeline view |
| `LeadScore.breakdown` | no | `[{ rule, points }]` scoring explanation (default `[]`) |
| `WebhookEvent.headers` | yes | sanitized inbound headers (signatures redacted) |
| `WebhookEvent.payload` | no | **immutable** inbound webhook log |
| `RoutingRule.conditions` | no | `[{ field, operator, value }]` rule conditions (default `[]`) |
| `RoutingResult.destinationIds` | no | selected destination ids (default `[]`) |
| `FieldMappingVersion.fields` | no | `[{ source, target, transforms, required, default }]` (default `[]`) |
| `Destination.config` | no | non-secret destination config (base URL, region, module…) |
| `Delivery.mappedPayload` | yes | snapshot of the mapped payload actually sent |
| `DeliveryAttempt.requestMeta` | yes | non-secret request metadata (URL, header name) |
| `ImportRowError.rawRow` | no | original parsed row for the downloadable error report |
| `ScoringRuleSet.rules` | no | `[{ id, label, condition, points }]` (default `[]`) |
| `AuditLog.before` | yes | sanitized pre-change snapshot |
| `AuditLog.after` | yes | sanitized post-change snapshot |
| `AuditLog.metadata` | yes | extra audit context |

**Secrets never live in JSON columns:** `IntegrationCredential.secret` is a plain
`String` holding AES-256-GCM ciphertext, and every JSON column above is documented
as sanitized/redacted.

---

## 8. Database enums (21 enums, 111 values)

- **TenantStatus** (2): `ACTIVE`, `SUSPENDED`
- **UserStatus** (3): `ACTIVE`, `INVITED`, `DISABLED`
- **ApiKeyStatus** (2): `ACTIVE`, `REVOKED`
- **LeadStatus** (5): `RECEIVED`, `PROCESSING`, `PROCESSED`, `REJECTED`, `FAILED`
- **LeadStage** (12): `RECEIVED`, `VALIDATION`, `NORMALIZATION`, `DEDUPLICATION`, `ENRICHMENT`, `SCORING`, `ROUTING`, `MAPPING`, `QUEUED`, `DELIVERY`, `COMPLETED`, `FAILED`
- **StageStatus** (5): `PENDING`, `RUNNING`, `PASSED`, `FAILED`, `SKIPPED`
- **ValidationStatus** (3): `PENDING`, `PASSED`, `FAILED`
- **DeduplicationStatus** (4): `PENDING`, `UNIQUE`, `DUPLICATE`, `DISABLED`
- **WebhookEventStatus** (4): `RECEIVED`, `PROCESSED`, `FAILED`, `DUPLICATE`
- **SourceType** (8): `GOOGLE_ADS`, `META_ADS`, `WEBSITE`, `LINKEDIN`, `API`, `WEBHOOK`, `CSV`, `CUSTOM`
- **DestinationType** (7): `SALESFORCE`, `ZOHO`, `DCT_CRM`, `HUBSPOT`, `PIPEDRIVE`, `CUSTOM_API`, `WEBHOOK`
- **DestinationStatus** (2): `ACTIVE`, `DISABLED`
- **ConnectionStatus** (4): `NOT_CONFIGURED`, `CONNECTED`, `DISCONNECTED`, `ERROR`
- **DeliveryStatus** (7): `PENDING`, `QUEUED`, `IN_PROGRESS`, `SUCCEEDED`, `FAILED`, `DEAD`, `SKIPPED`
- **DeliveryAttemptStatus** (6): `SUCCEEDED`, `FAILED`, `TIMEOUT`, `RATE_LIMITED`, `NOT_CONFIGURED`, `REJECTED`
- **CredentialType** (5): `WEBHOOK_HMAC`, `API_KEY`, `BASIC`, `OAUTH`, `BEARER`
- **ImportJobStatus** (6): `PENDING`, `PARSING`, `PROCESSING`, `COMPLETED`, `FAILED`, `CANCELLED`
- **AuditActorType** (4): `USER`, `API_KEY`, `SYSTEM`, `WORKER`
- **RuleOperator** (14): `EQ`, `NEQ`, `CONTAINS`, `NOT_CONTAINS`, `STARTS_WITH`, `ENDS_WITH`, `GT`, `GTE`, `LT`, `LTE`, `IN`, `NOT_IN`, `EXISTS`, `NOT_EXISTS`
- **MatchedField** (5): `EXTERNAL_ID`, `PHONE`, `EMAIL`, `PHONE_EMAIL`, `CUSTOM`
- **FieldMappingStatus** (3): `DRAFT`, `ACTIVE`, `ARCHIVED`

---

## 9. Application object inventory (kept separate from the database count)

These are **TypeScript/Zod application objects** — they are *not* database models and
are **not** included in the 29-model / 29-table count above.

### 9.1 API request/response DTOs — 32 exports across 12 files

`apps/api/src/modules/<module>/<module>.dtos.ts` (Zod schemas wrapped with
`nestjs-zod`'s `createZodDto`, so the same object serves as validation **and**
OpenAPI request/response definition):

| File | Exports |
|---|---|
| `api-keys/api-keys.dtos.ts` | 2 |
| `audit-logs/audit-logs.dtos.ts` | 1 |
| `auth/auth.dtos.ts` | 2 |
| `automation/automation.dtos.ts` | 3 |
| `destinations/destinations.dtos.ts` | 3 |
| `field-mappings/field-mappings.dtos.ts` | 4 |
| `imports/imports.dtos.ts` | 2 |
| `leads/leads.dtos.ts` | 3 |
| `roles/roles.dtos.ts` | 2 |
| `routing-rules/routing-rules.dtos.ts` | 3 |
| `sources/sources.dtos.ts` | 4 |
| `users/users.dtos.ts` | 3 |
| **Total** | **32** |

Response envelopes are shared application objects
(`packages/types/src/errors.ts`): `ApiSuccessBody<T>` (`{ success: true, data }`),
`ApiErrorBody`, and the union `ApiResponse<T>`.

### 9.2 Validation schemas — 33 exported Zod schemas

`packages/validation/src/index.ts` (41 `.object()` shapes in total incl. nested):

`idSchema`, `cursorQuerySchema`, `dateRangeQuerySchema`, `emailSchema`, `phoneSchema`,
`passwordSchema`, `leadListQuerySchema`, `deliveryListQuerySchema`, `auditListQuerySchema`,
`importListQuerySchema`, `ruleConditionSchema`, `routingConditionsSchema`,
`routingRuleUpsertSchema`, `routingPreviewSchema`, `fieldMappingFieldSchema`,
`fieldMappingCreateSchema`, `fieldMappingVersionSchema`, `dedupConfigSchema`,
`scoringRuleSchema`, `scoringRuleSetUpsertSchema`, `sourceCreateSchema`,
`sourceUpdateSchema`, `sourceAccountCreateSchema`, `destinationCreateSchema`,
`destinationUpdateSchema`, `credentialSetSchema`, `loginSchema`, `refreshSchema`,
`userCreateSchema`, `userUpdateSchema`, `roleUpsertSchema`, `apiKeyCreateSchema`,
`changePasswordSchema`.

### 9.3 Domain / business entities and TypeScript types

**`packages/types/src/lead.ts`** — the canonical lead shape and the field catalog:
`CanonicalLead`, `CanonicalName`, `CanonicalLocation`, `CanonicalSourceInfo`,
`CanonicalConsent`, `FieldMappingField`, `FieldTransform`, `LeadFieldDefinition`,
`LeadFieldCategory`, `LeadFieldCategoryDefinition`, `LeadFieldType`, plus the
`LEAD_FIELDS` / `LEAD_FIELD_CATEGORIES` catalogs.

**`packages/types/src/api.ts`** — `RequestActor`, `CursorQuery`, `CursorPage`.

**`packages/types/src/permissions.ts`** — `Permission`, `SystemRoleName`.

**`packages/types/src/errors.ts`** — `ErrorCode`, `ApiErrorBody`, `ApiSuccessBody<T>`, `ApiResponse<T>`.

**`packages/types/src/enums.ts`** — 23 exported enum constants/types mirroring (and in one
case extending) the database enums; also `RoutingMatchModes`, `DatePresets`,
`MONTH_NAMES`, `DAY_NAMES`, `RULE_OPERATOR_GROUPS`, `ROUTING_FALLBACK_TYPE`/`ROUTING_FALLBACK_LABEL`.

**`packages/integrations/src/conditions.ts`** — routing evaluation objects
(`RoutingFallback`, `RoutingEvaluation`, `RoutingOutcome`, …).

### 9.4 Webhook payload objects

| Object | Location | Shape |
|---|---|---|
| Inbound webhook ingress | `apps/api/src/modules/webhooks/webhooks.controller.ts` → `webhooks.service.ts` | `POST /webhooks/inbound/:publicId`, body typed `unknown` (free-form provider JSON) → persisted verbatim to `WebhookEvent.payload` / `LeadRawPayload.payload` |
| `IngressResult` | `webhooks.service.ts` | fast-ack response of the ingress endpoint |
| Webhook request body builder | `packages/integrations/src/adapters/webhook.ts` → `buildWebhookBody(...)` | **envelope** (default): `{ idempotencyKey, attempt, correlationId, leadId, payload, timestamp }` or **flat**: the mapped fields top-level, selected by destination `config.bodyMode` |
| Inbound event log views | `apps/web/src/lib/types.ts` → `RawPayload` etc. | web-side view objects |

### 9.5 Integration / destination payloads

`packages/integrations/src/types.ts` (6 objects):

| Object | Purpose |
|---|---|
| `DestinationContext` | destination id/type/status/config seen by an adapter |
| `CredentialContext` | decrypted credential material handed to an adapter (never logged) |
| `DeliveryRequest` | everything an adapter needs: destination, credential, mapped payload, attempt, correlation, lead |
| `DeliveryResult` | `{ success, responseStatus, responseBody, errorCode, errorMessage, retryable, rateLimited, retryAfterMs, externalId, requestUrl, durationMs }` |
| `ConnectionTestResult` | `{ ok, status, latencyMs, error, detail }` |
| `DestinationAdapter` | the adapter interface (`type`, `validate`, `deliver`, `testConnection`) |

**7 adapters** implement it — `packages/integrations/src/adapters/`:
`salesforce.ts`, `zoho.ts`, `dct-crm.ts`, `hubspot.ts`, `pipedrive.ts`,
`custom-api.ts`, `webhook.ts`. Supporting objects: `MappingContext` /
`MappingOutcome` (`mapping.ts`), `DestinationContext` helpers (`helpers.ts`),
`conditions.ts` (routing engine).

### 9.6 Worker job payloads — 11 objects

`packages/types/src/jobs.ts` (the explicit producer/consumer contract):

`JobBase` (`correlationId`) → `LeadIntakeJob`, `LeadProcessingJob`, `EnrichLeadJob`,
`ScoreLeadJob`, `RouteLeadJob`, `DeliverJob`, `ReplayDeliveryJob`, `ImportCsvJob`;
plus `DeliveryPayload` (`{ canonical, mapped }`).

`packages/types/src/queues.ts` — queue/job contract: `QUEUES` (8 queues),
`JOB_NAMES` (8 job names), `QueueName`, `JobName`, `DLQ_SUFFIX`, `DEFAULT_JOB_OPTIONS`,
`BACKOFF_BASE_MS` / `BACKOFF_MAX_MS`, `backoffDelayMs()`.

Queues: `lead-intake`, `lead-processing`, `enrichment`, `scoring`, `routing`,
`delivery`, `retry`, `csv-import` (+ a `-dlq` dead-letter queue for each).

### 9.7 Configuration objects

**`packages/config/src/index.ts`** — `Env` (Zod), `getEnv()`, `resetEnvCache()`,
`assertSafeDatabaseUrl()`. **40 environment keys**, grouped:

- **HTTP** `NODE_ENV`, `LOG_LEVEL`, `LOG_PRETTY`, `API_PORT`, `API_HOST`, `CORS_ORIGINS`,
  `PUBLIC_API_BASE_URL`, `API_JSON_BODY_LIMIT`, `API_RATE_LIMIT_PER_MIN`,
  `AUTH_RATE_LIMIT_PER_MIN`, `WEBHOOK_RATE_LIMIT_PER_MIN`, `NEXT_PUBLIC_API_URL`
- **Data/infra** `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- **Auth/crypto (secrets)** `JWT_ACCESS_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`,
  `JWT_ISSUER`, `ENCRYPTION_KEY`, `DEFAULT_WEBHOOK_SIGNING_SECRET`
- **Worker/queue** `LEAD_INTAKE_CONCURRENCY`, `LEAD_PROCESSING_CONCURRENCY`,
  `DELIVERY_CONCURRENCY`, `CSV_IMPORT_CONCURRENCY`, `DELIVERY_MAX_ATTEMPTS`,
  `DELIVERY_TIMEOUT_MS`
- **Storage** `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR`, `S3_ENDPOINT`, `S3_REGION`,
  `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- **Observability/safety** `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `SENTRY_DSN`,
  `APP_TIMEZONE`, `SSRF_ALLOW_PRIVATE_HOSTS`

Also: `packages/config` is the only place that reads `process.env`; secret keys are
`min(32)`-length-validated (`JWT_ACCESS_SECRET`) or required (`DATABASE_URL`,
`ENCRYPTION_KEY`).

### 9.8 HTTP surface (for orientation, not an object inventory)

**16 controllers, 79 routes** — prefixes: `/health`, `/auth`, `/leads`, `/sources`,
`/webhooks`, `/destinations`, `/field-mappings`, `/routing-rules`, `/automation`,
`/imports`, `/deliveries`, `/analytics`, `/audit-logs`, `/users`, `/roles`, `/api-keys`.

---

## 10. Source files used to verify this inventory

| Purpose | Path |
|---|---|
| Prisma models, enums, fields, constraints | `prisma/schema.prisma` |
| Migration history | `prisma/migrations/` (`20260930102343_init`, `20261001064433_delivery_replay_cycle`, `20261005000000_single_application_identity`, `20261006100000_business_lead_id`) |
| Live table/column counts | PostgreSQL `information_schema.tables` / `information_schema.columns` (database `middleware`) |
| Validation schemas | `packages/validation/src/index.ts` |
| DTOs | `apps/api/src/modules/*/**.dtos.ts` |
| Domain/TS types | `packages/types/src/{lead,api,errors,enums,permissions}.ts` |
| Worker job payloads | `packages/types/src/jobs.ts` |
| Queue contract | `packages/types/src/queues.ts` |
| Integration payloads & adapter contract | `packages/integrations/src/types.ts` |
| Mapping engine | `packages/integrations/src/mapping.ts` |
| Routing engine | `packages/integrations/src/conditions.ts` |
| Webhook body builder | `packages/integrations/src/adapters/webhook.ts` |
| Configuration | `packages/config/src/index.ts` |
| HTTP routes | `apps/api/src/modules/*/**.controller.ts` |
| Web ingress | `apps/api/src/modules/webhooks/webhooks.controller.ts` |
| Web view types | `apps/web/src/lib/types.ts` |

---

## 11. Discrepancies found (schema vs migrations vs application code)

Verified by `prisma validate`, `prisma migrate status`, `prisma migrate diff` (empty
→ **no schema/database drift**) and by cross-checking the schema against
`packages/types`.

| # | Discrepancy | Evidence | Severity |
|---|---|---|---|
| 1 | **`RuleOperator` is declared in the schema but never used as a field type.** It is the only one of the 21 enums not referenced by any model. | `prisma/schema.prisma:172`; 20/21 enums used | Low — dead declaration; routing conditions are stored as JSON, not as a DB enum |
| 2 | **TS `RuleOperators` is a superset of the DB enum** (17 vs 14): the TS list adds `BETWEEN`, `BEFORE`, `AFTER`. | `packages/types/src/enums.ts:122-141` vs `prisma/schema.prisma:172-187` | **No runtime impact today** — `RoutingRule.conditions` is a `Json` column, so the extra operators are never written to a DB enum. Would become a real drift if `RuleOperator` were ever used as a column type |
| 3 | **The documented enum-drift test does not exist.** `enums.ts` states "a drift test lives in `packages/types/src/enums.spec.ts`", but that file is absent. | header comment in `packages/types/src/enums.ts`; `packages/types/src/` contains only `lead.spec.ts` and `queues.spec.ts` | Medium — the safeguard the comment promises is missing, which is how discrepancy #2 could persist unnoticed |
| 4 | **`Tenant` + `TenantStatus` are orphaned.** The model has no relation to or from any other model, and no `tenantId` column exists anywhere, yet the table still exists in the database and the enum is still used by `Tenant.status`. | `prisma/schema.prisma:207-216`; `20261005000000_single_application_identity`; `prisma/seed.ts:38` still calls `prisma.tenant.upsert` | Low — retained for seeding/tests; documented further in `docs/TENANT-REMOVAL-AUDIT.md` |
| 5 | **`RoutingResult.ruleId` and `FieldMapping.activeVersionId` are soft references** — nullable `*Id` scalars with no `@relation`, so no FK constraint protects them. | `prisma/schema.prisma:583`, `prisma/schema.prisma:600` vs the 30 declared FKs | Low/by design — allows the referenced row to be deleted without cascading; nothing verifies it still points at an existing row |

**Consistency confirmations (no discrepancy):**

- Prisma schema ↔ database: **no drift** (empty migration diff, exit 0).
- All 4 migrations are applied; `prisma migrate status` reports up to date.
- 29 models ↔ 29 application tables (1 : 1, no `@@map` overrides anywhere).
- 338 Prisma fields − 60 relation fields = 278 = actual application column count.
- Shared TS enums match the database enums for all enums **except** `RuleOperator`
  (#2 above).
- Generated client output (`packages/database/src/generated/`) and `dist/` / `.next/`
  are git-ignored build artifacts, not inventory sources.


