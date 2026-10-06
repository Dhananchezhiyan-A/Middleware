# Tenant Removal Audit

## Status

**Blocked before implementation by the data-safety gate.** The configured Middleware database contains 2 `Tenant` rows. A read-only aggregate check found records in one partition among the sampled core models, but did not establish whether the other tenant has data in every tenant-bearing table. No tenant data, schema, API, or application code has been changed. No migration has been generated or run.

The database client safety check constrained the query to the configured Middleware database. The query printed aggregate counts only and did not print tenant identifiers or customer data.

## Search Scope

Searched tenant-related names and semantics across API, web, worker, shared packages, Prisma schema and migrations, tests, scripts, documentation, and configuration. Also searched `companyId`, `organizationId`, `workspaceId`, and account identifiers to distinguish tenancy from business relationships. Generated `dist`, `.next`, and Prisma generated code contain derived matches and must not be edited by hand.

The source search found tenant references throughout 33 API source files, 11 worker source files, 14 web source files, shared package source, 8 test files, 5 docs, and the Prisma schema/initial migration. Search output is a dependency inventory, not evidence that all stored rows belong to a single partition.

## Dependency Inventory

| Location | File | Tenant Logic | Dependency | Action |
|----------|------|--------------|------------|--------|
| Data model | `prisma/schema.prisma` | `Tenant`/`TenantStatus`; tenant fields, relations, indexes, and uniqueness on identity, sources, accounts, credentials, leads, processing history, webhooks, routing, mappings, destinations, deliveries, imports, automation, and audit | Cascading foreign keys, nullable audit ownership, tenant-scoped unique keys and idempotency | VERIFY: preserve data and resolve collisions before a reviewed migration |
| Migration history | `prisma/migrations/20260930102343_init/migration.sql`, `prisma/migrations/20261001064433_delivery_replay_cycle/` | Initial tenant table, columns, foreign keys, indexes, and unique constraints; later delivery-cycle schema change | Existing database history must remain valid; do not rewrite applied migrations | KEEP history; add a new reviewed migration only after approval |
| Tenant helper | `packages/database/src/tenant.ts`, `packages/database/src/index.ts` | `assertSameTenant` and `assertSameTenantRequired` return 404 on mismatched ownership | Anti-enumeration behavior currently depends on tenant identity | REFACTOR after defining single-tenant record access behavior |
| Request identity | `apps/api/src/common/decorators/current-user.decorator.ts`, `apps/api/src/common/guards/jwt-auth.guard.ts`, `apps/api/src/common/**` | Actor context and JWT/API-key authentication carry tenant identity and tenant status | Authentication, active-user checks, API-key status/scopes, and permission loading are independent and must remain | REFACTOR tenant-only claims/checks; KEEP auth, sessions, API keys, and RBAC |
| Registration/login | `apps/api/src/modules/auth/auth.controller.ts`, `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/modules/auth/auth.dtos.ts`, `packages/validation/src/index.ts` | Registration creates tenant, admin, roles, defaults, then issues a session; login can resolve by workspace slug | User bootstrap, passwords, JWT, sessions, role/permission assignment | VERIFY bootstrap and login contract before removing workspace inputs; KEEP authentication |
| Tenant profile API | `apps/api/src/modules/tenants/tenants.controller.ts`, `apps/api/src/modules/tenants/tenants.service.ts`, `apps/api/src/modules/tenants/tenants.dtos.ts`, `apps/api/src/modules/tenants/tenants.module.ts`, `apps/api/src/app.module.ts` | `/tenants/me` read/rename and module registration | Workspace profile UI and `tenant:write` permission | REMOVE tenant-only endpoint/UI after API compatibility approval |
| Domain API scoping | `apps/api/src/modules/{analytics,api-keys,audit-logs,automation,deliveries,destinations,field-mappings,imports,leads,roles,routing-rules,sources,users}/*` | Actor tenant IDs passed through services and Prisma filters/writes | Prevents cross-partition reads/writes; joins and parent-child checks also use tenant IDs | REFACTOR queries and signatures only after choosing the retained dataset; KEEP business ownership relations and permission checks |
| Webhook ingress | `apps/api/src/modules/webhooks/webhooks.service.ts`, `apps/api/src/modules/sources/sources.service.ts` | Resolves account ownership and secrets with tenant ID; webhook idempotency unique key includes tenant | HMAC, encrypted secret lookup, source/account association, duplicate handling | REFACTOR tenant-only predicates; KEEP `publicId`, `sourceId`, `sourceAccountId`, HMAC, and idempotency |
| Audit context | `apps/api/src/infra/audit.module.ts`, `apps/api/src/modules/audit-logs/*`, `packages/shared/src/correlation.ts`, `packages/shared/src/logger.ts` | Audit rows and ambient context may carry tenant ID | Actor/action/entity/timestamp/correlation and secret sanitization remain valuable | REFACTOR tenant metadata only; KEEP audit/security events and correlation context |
| Worker pipeline | `apps/worker/src/{delivery,pipeline,processors,queues,workers}/**` | Tenant ID in job payloads, worker queries, delivery idempotency, audit calls, and failure messages | In-flight/retry/DLQ/replay jobs may still contain old payloads; unique constraints use tenant IDs | VERIFY queue drain/compatibility window; REFACTOR payloads and queries only after data decision |
| Deduplication | `apps/worker/src/pipeline/validate-normalize.ts`, `apps/worker/src/pipeline/pipeline.service.ts` | Dedup hashes are salted with tenant ID | The salt prevents cross-tenant correlation and helps resist reversal of indexed hashes | REFACTOR to a stable application-specific secret salt; do not make hashes unsalted |
| Shared contracts | `packages/types/src/{api,enums,jobs,permissions}.ts`, `packages/integrations/src/types.ts`, `apps/web/src/lib/types.ts` | Actor/job/integration types expose tenant fields; permission catalog includes `tenant:write` | Shared compile-time contracts and role permissions | REFACTOR tenant-only fields and permission; KEEP all unrelated permissions/types |
| Frontend identity/settings | `apps/web/src/lib/{auth,queries/core,queries/keys,queries/system,types}.ts`, `apps/web/src/app/(app)/system/settings/page.tsx` | Auth bootstrap stores tenant identity; settings reads/renames tenant profile | Normal user profile, auth state, navigation, and permissions must remain | REMOVE tenant profile/switching UI; REFACTOR bootstrap; KEEP user menu/profile |
| Frontend labels | `apps/web/src/components/shell/{sidebar,topbar,user-menu}.tsx`, `apps/web/src/components/system/roles-table.tsx`, `apps/web/src/components/destinations/destination-dialog.tsx`, `apps/web/src/app/{layout.tsx,login/page.tsx}` | Workspace name/slug, tenant status/ID, and tenant-isolation copy | Normal navigation, destination uniqueness, login, and RBAC UI | REMOVE tenant-only labels; VERIFY destination naming/uniqueness semantics |
| Integration/domain tests | `tests/integration/{audit,helpers,idempotency,pipeline,replay}.test.ts` | Fixtures create tenants and assert tenant-keyed filters/uniqueness | Continue to cover audit, idempotency, processing, replay, and secrets after conversion | REFACTOR fixtures and preserve non-tenancy assertions |
| Isolation tests | `tests/integration/tenant-isolation.test.ts` | Explicit cross-tenant 404 and tenant-filter assertions | Tests only tenancy boundaries | REMOVE after replacing with single-dataset auth/RBAC/ownership regression coverage |
| Queue tests | `tests/queue/{pipeline-e2e,queue-mechanics}.test.ts` | Test tenant creation and queue payload fields | Queue, worker, delivery, and cleanup behavior remain | REFACTOR tenant fixture; KEEP queue/worker coverage |
| API/docs | `docs/api-architecture.md`, `docs/api-gaps.md`, `docs/api-inventory.md`, `docs/api-security-audit.md`, `docs/openapi.yaml`, root `package.json` description | Architecture, API contracts, security findings, examples, and product description describe tenants | Existing API consumers and security assumptions | REFACTOR docs after implementation approval; retain accurate security and RBAC documentation |
| Environment | `.env`, `.env.example`, `packages/config/src/index.ts`, `scripts/gen-dev-env.mjs` | Search found no tenant-specific environment variable; Redis credentials are unrelated | Runtime configuration and database safety guard | KEEP unrelated config; VERIFY future config changes |
| Generated output | `apps/api/dist/**`, `apps/worker/dist/**`, `apps/web/.next/**`, `packages/database/src/generated/**` | Generated tenant references reflect source/schema | Recreated by build/code generation | KEEP generated from source; do not hand-edit |
| Business identifiers | `sourceAccountId`, account `id`/`publicId`, `sourceId`, `destinationId`, `correlationId` in API, workers, webhooks, and schema | These are source/account/destination relationships or request tracing, not tenant identifiers | Secure webhook routing, lead ownership, delivery, idempotency, traceability | KEEP; do not remove as part of tenant cleanup |

## Database Dependency Graph

`Tenant` currently owns or is referenced by `User`, `Role`, `UserSession`, `ApiKey`, `LeadSource`, `LeadSourceAccount`, `IntegrationCredential`, `Lead`, `LeadRawPayload`, `LeadProcessing`, `LeadStageEvent`, `LeadScore`, `LeadDuplicate`, `WebhookEvent`, `RoutingRule`, `RoutingRuleDestination`, `RoutingResult`, `FieldMapping`, `FieldMappingVersion`, `Destination`, `DestinationHealth`, `Delivery`, `DeliveryAttempt`, `ImportJob`, `ImportRowError`, `DeduplicationConfig`, `ScoringRuleSet`, and `AuditLog`. Most ownership relations cascade on tenant deletion. `AuditLog.tenantId` is nullable. `DestinationHealth.tenantId` is indexed but its declared relation is through `destination`.

Uniqueness/idempotency keys containing tenant ID include user email, role name, source code, lead external ID, webhook event idempotency, score version, field mapping identity, destination name, delivery identity, delivery-attempt number, dedup config, and scoring version. Dropping the tenant component requires checking collisions and replacing relevant database constraints without weakening idempotency.

## Database Check and Required Decision

Read-only aggregate results from the guarded Middleware database:

| Check | Result |
|-------|--------|
| Tenant rows | 2 |
| Tenant partitions with rows in sampled core models | 1 |
| Sampled totals | 1 user, 1 source, 1 source account, 1 lead, 0 destinations, 0 deliveries |
| Counts for all other tenant-bearing tables | Not yet checked |

The second tenant row triggers the explicit stop condition even though the sampled models show one populated partition. Do not merge or delete either partition implicitly. Before implementation, decide which tenant/data set is canonical and what to do with the other tenant's records, including roles, API keys, sessions, credentials, webhook events, audit logs, imports, and processing history. Confirm whether the second tenant is disposable test data or must be preserved/migrated. Also approve collision handling, a backup, and rollback strategy. No tenant identifiers were printed in this report.

Until that decision is supplied, phases involving code removal, API/auth changes, schema edits, migration generation, test deletion, and single-tenant documentation remain intentionally unstarted. No commit, push, or deployment was performed.