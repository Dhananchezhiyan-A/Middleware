# API Inventory — Lead Integration & Distribution Middleware

**Audit date:** 2026-10-01 · **Method:** full-codebase inspection (controllers → services → Prisma, web queries, worker, tests) · **No code was changed.**

| Metric | Value |
|---|---|
| HTTP routes | **81** across **17 controllers** |
| Global prefix / version | `/api/v1` (URI versioning, `apps/api/src/main.ts:49-50`) |
| Auth | Bearer JWT **or** `x-api-key` header (global `JwtAuthGuard`) |
| Permission-guarded routes | 73 (`@RequirePermission`) · `@Public` 6 · authenticated-no-permission 2 |
| Envelope | `{ success, data }` success · `{ success:false, error:{code,message,requestId,details?} }` error |
| Pagination | cursor (`take+1`) on 9 list endpoints; **6 unbounded lists** (finding) |
| OpenAPI artifact | **none existed** → generated at `docs/openapi.yaml` by this audit |
| Frontend consumers | 69 distinct calls, all matched to real routes (0 calls to missing endpoints) |

Status legend: `IMPLEMENTED` works end-to-end · `PARTIAL` exists but incomplete behavior · `BROKEN` exists but returns wrong/unsafe data · `†` implemented but has **no consumer** (see §E).

---

## A. IMPLEMENTED APIs

### auth (`apps/api/src/modules/auth/auth.controller.ts`)

| Method | Endpoint | Module | Auth | Permission | Tenant Scoped | Status | Purpose |
|---|---|---|---|---|---|---|---|
| POST | /api/v1/auth/register | auth | Public (20/min) | — | n/a (creates tenant) | IMPLEMENTED | Register workspace + admin + system roles in one tx; sets refresh cookie, returns tokens (201) |
| POST | /api/v1/auth/login | auth | Public (20/min) | — | via credentials | IMPLEMENTED | Email/password (+optional slug) → access+refresh; generic 401, audits failures |
| POST | /api/v1/auth/refresh | auth | Public (20/min) | — | via refresh token | IMPLEMENTED | Rotating refresh (cookie or body); Origin check; reuse detection revokes all sessions |
| POST | /api/v1/auth/logout | auth | Public | — | via refresh token | IMPLEMENTED | Revokes session + clears cookie; **no audit row** (finding H-7) |
| GET | /api/v1/auth/me | auth | Session | — | own tenant | IMPLEMENTED | Current user + role + permissions (bootstrap for web) |

### tenants (`tenants/tenants.controller.ts`)

| Method | Endpoint | Module | Auth | Permission | Tenant Scoped | Status | Purpose |
|---|---|---|---|---|---|---|---|
| GET | /api/v1/tenants/me | tenants | Session | — | own tenant | IMPLEMENTED | Workspace name/slug/status/createdAt |
| PATCH | /api/v1/tenants/me | tenants | Session | tenant:write | own tenant | IMPLEMENTED | Rename workspace (slug immutable) |

### users (`users/users.controller.ts`)

| Method | Endpoint | Module | Auth | Permission | Tenant Scoped | Status | Purpose |
|---|---|---|---|---|---|---|---|
| GET | /api/v1/users | users | Session/Key | users:read | yes | IMPLEMENTED | List users (cursor `limit≤100`, includes role + counts) |
| POST | /api/v1/users | users | Session/Key | users:write | yes (actor) | IMPLEMENTED | Create user with role (201; bcrypt hash never returned) |
| PATCH | /api/v1/users/:id | users | Session/Key | users:write | yes (check-then-act) | IMPLEMENTED | Update name/role/status (activate/deactivate; self-disable refused) |

### roles (`roles/roles.controller.ts`)

| Method | Endpoint | Module | Auth | Permission | Tenant Scoped | Status | Purpose |
|---|---|---|---|---|---|---|---|
| GET | /api/v1/roles | roles | Session/Key | roles:read | yes | IMPLEMENTED | List roles with permission arrays + userCount (**unbounded**, finding H-8) |
| GET | /api/v1/roles/permissions | roles | Session/Key | roles:read | n/a (static) | IMPLEMENTED | Permission catalog (34 codes) + 4 role templates — serves the "GET /permissions" requirement |
| POST | /api/v1/roles | roles | Session/Key | roles:write | yes (actor) | IMPLEMENTED | Create custom role (201; permissions validated against catalog) |
| PATCH | /api/v1/roles/:id | roles | Session/Key | roles:write | yes | IMPLEMENTED | Update role; system roles immutable (409/403) |
| DELETE | /api/v1/roles/:id | roles | Session/Key | roles:write | yes | IMPLEMENTED | Delete; refused while assigned or system |

### api-keys (`api-keys/api-keys.controller.ts`)

| Method | Endpoint | Module | Auth | Permission | Tenant Scoped | Status | Purpose |
|---|---|---|---|---|---|---|---|
| GET | /api/v1/api-keys | api-keys | Session/Key | apikeys:read | yes | IMPLEMENTED | List keys (prefix, status, lastUsed; hash never returned; cursor) |
| POST | /api/v1/api-keys | api-keys | Session/Key | apikeys:write | yes (actor) | IMPLEMENTED | Create key; raw value returned **once** (201). **Empty scopes ⇒ wildcard `*` admin key** (finding H-2) |
| DELETE | /api/v1/api-keys/:id | api-keys | Session/Key | apikeys:write | yes | IMPLEMENTED | Revoke (idempotent) |

### audit-logs (`audit-logs/audit-logs.controller.ts`)

| Method | Endpoint | Module | Auth | Permission | Tenant Scoped | Status | Purpose |
|---|---|---|---|---|---|---|---|
| GET | /api/v1/audit-logs | audit-logs | Session/Key | audit:read | yes | IMPLEMENTED | Filter (action/entityType/entityId/actor/from/to), cursor; sanitized metadata, no secrets |

### leads (`leads/leads.controller.ts`)

| Method | Endpoint | Module | Auth | Permission | Tenant Scoped | Status | Purpose |
|---|---|---|---|---|---|---|---|
| GET | /api/v1/leads | leads | Session/Key | leads:read | yes | IMPLEMENTED | List/filter (status, sourceId, destinationId, dedupStatus, date range), cursor + total; search by internal ID, business Lead ID, name, email, phone, or provider ID |
| POST | /api/v1/leads | leads | Session/Key | leads:write | yes (actor) | IMPLEMENTED | Manual create → enqueues intake (201). **409** on duplicate `(tenant,sourceAccount,externalLeadId)`; **no idempotency without externalLeadId** (finding H-5) |
| GET | /api/v1/leads/:id | leads | Session/Key | leads:read | yes (404 cross-tenant) | IMPLEMENTED | Full detail incl. source, duplicate link, deliveries, scores, stages |
| GET | /api/v1/leads/:id/timeline | leads | Session/Key | leads:read | yes | IMPLEMENTED | Immutable LeadStageEvent timeline |
| GET | /api/v1/leads/:id/payloads | leads | Session/Key | leads:read | yes | IMPLEMENTED | Raw inbound payloads (unsanitized — see H-9) |
| POST | /api/v1/leads/:id/replay | leads | Session/Key | leads:replay | yes | IMPLEMENTED | Re-run pipeline (201 `{replayed:true}`), audited |
| DELETE | /api/v1/leads/:id | leads | Session/Key | leads:delete | yes | IMPLEMENTED | Hard delete + audit; **no frontend consumer** (§E) |

### sources (`sources/sources.controller.ts`)

| Method | Endpoint | Module | Auth | Permission | Tenant Scoped | Status | Purpose |
|---|---|---|---|---|---|---|---|
| GET | /api/v1/sources | sources | Session/Key | sources:read | yes | IMPLEMENTED | List sources (**unbounded**, finding H-8) |
| POST | /api/v1/sources | sources | Session/Key | sources:write | yes (actor) | IMPLEMENTED | Create source (201; tenant-unique code) |
| GET | /api/v1/sources/:id | sources | Session/Key | sources:read | yes | IMPLEMENTED | Detail; **no frontend consumer** (§E) |
| PATCH | /api/v1/sources/:id | sources | Session/Key | sources:write | yes | IMPLEMENTED | Update **name/config only** — no activation exists: `LeadSource` has no status column and `sourceUpdateSchema` has no status field (see §C) |
| DELETE | /api/v1/sources/:id | sources | Session/Key | sources:write | yes | IMPLEMENTED | Delete; blocked (409) while leads attached |
| GET | /api/v1/sources/:id/accounts | sources | Session/Key | sources:read | yes | IMPLEMENTED | Accounts + inbound webhook URLs (publicId) |
| POST | /api/v1/sources/:id/accounts | sources | Session/Key | sources:write | yes | IMPLEMENTED | Create account with provider and required-field configuration; only the public webhook URL is needed for ingestion |
| PATCH | /api/v1/sources/accounts/:accountId | sources | Session/Key | sources:write | yes | IMPLEMENTED | Update account; **not nested under `:id`** (naming); **no consumer** (§E) |
| DELETE | /api/v1/sources/accounts/:accountId | sources | Session/Key | sources:write | yes | IMPLEMENTED | Delete account |
| POST | /api/v1/sources/accounts/:accountId/rotate-secret | sources | Session/Key | sources:write | yes | IMPLEMENTED (legacy) | Rotate a legacy stored HMAC credential; not required or used by public inbound webhook requests |

### webhooks (`webhooks/webhooks.controller.ts`)

| Method | Endpoint | Module | Auth | Permission | Tenant Scoped | Status | Purpose |
|---|---|---|---|---|---|---|---|
| POST | /api/v1/webhooks/inbound/:publicId | webhooks | Public (600/min) | — | derived from publicId | IMPLEMENTED | Public-URL inbound lead ingress; detects common provider payloads, normalizes aliases, validates configured required fields, stores raw payload, applies account-level idempotency and fast-acks 201 after enqueue (queue-fail → 503) |
| GET | /api/v1/webhooks/events | webhooks | Session/Key | sources:read | yes | IMPLEMENTED | Event log (status/account/cursor); **query not zod-validated** (inline type), **no consumer** (§E) |
| GET | /api/v1/webhooks/events/:id | webhooks | Session/Key | sources:read | yes | IMPLEMENTED | Single event detail; **no consumer** (§E) |

### destinations (`destinations/destinations.controller.ts`)

| Method | Endpoint | Module | Auth | Permission | Tenant Scoped | Status | Purpose |
|---|---|---|---|---|---|---|---|
| GET | /api/v1/destinations/types | destinations | Session/Key | destinations:read | n/a (static) | IMPLEMENTED | 7 destination types + config metadata |
| GET | /api/v1/destinations | destinations | Session/Key | destinations:read | yes | IMPLEMENTED | List (**unbounded**, finding H-8) |
| POST | /api/v1/destinations | destinations | Session/Key | destinations:write | yes (actor) | IMPLEMENTED | Create (201; tenant-unique name) |
| GET | /api/v1/destinations/:id | destinations | Session/Key | destinations:read | yes | IMPLEMENTED | Detail; credential metadata only (`stored:true`, never the value) |
| PATCH | /api/v1/destinations/:id | destinations | Session/Key | destinations:write | yes | IMPLEMENTED | Update config/status |
| DELETE | /api/v1/destinations/:id | destinations | Session/Key | destinations:write | yes | IMPLEMENTED | Delete (+ health row) |
| PUT | /api/v1/destinations/:id/credential | destinations | Session/Key | destinations:write | yes | IMPLEMENTED | Write-only secret (AES-256-GCM at rest) |
| DELETE | /api/v1/destinations/:id/credential | destinations | Session/Key | destinations:write | yes | IMPLEMENTED | Remove credential |
| GET | /api/v1/destinations/:id/health | destinations | Session/Key | destinations:read | yes | IMPLEMENTED | Last probe result; **no consumer** (§E) |
| POST | /api/v1/destinations/:id/test | destinations | Session/Key | destinations:test | yes | IMPLEMENTED | Real outbound probe through SSRF-safe adapter (201), audited |

### field-mappings (`field-mappings/field-mappings.controller.ts`)

| Method | Endpoint | Module | Auth | Permission | Tenant Scoped | Status | Purpose |
|---|---|---|---|---|---|---|---|
| GET | /api/v1/field-mappings | field-mappings | Session/Key | mappings:read | yes | IMPLEMENTED | List (destinationId filter, cursor) |
| GET | /api/v1/field-mappings/:id | field-mappings | Session/Key | mappings:read | yes | IMPLEMENTED | Detail incl. all versions |
| POST | /api/v1/field-mappings | field-mappings | Session/Key | mappings:write | yes (actor) | IMPLEMENTED | Create + v1 (201; optional immediate activate) |
| POST | /api/v1/field-mappings/:id/versions | field-mappings | Session/Key | mappings:write | yes | IMPLEMENTED | Append immutable version (201) |
| POST | /api/v1/field-mappings/:id/activate | field-mappings | Session/Key | mappings:write | yes | IMPLEMENTED | Activate version (201; rollback = activate older) |
| DELETE | /api/v1/field-mappings/:id | field-mappings | Session/Key | mappings:write | yes | IMPLEMENTED | Delete mapping + versions |

### routing-rules (`routing-rules/routing-rules.controller.ts`)

| Method | Endpoint | Module | Auth | Permission | Tenant Scoped | Status | Purpose |
|---|---|---|---|---|---|---|---|
| GET | /api/v1/routing-rules | routing-rules | Session/Key | routing:read | yes | IMPLEMENTED | Ordered rules + destinations (**unbounded**, H-8) |
| POST | /api/v1/routing-rules | routing-rules | Session/Key | routing:write | yes (actor) | IMPLEMENTED | Create (201; priority, conditions, destination targets) |
| PATCH | /api/v1/routing-rules/:id | routing-rules | Session/Key | routing:write | yes | IMPLEMENTED | Partial update incl. `{enabled}` toggle; version bump |
| DELETE | /api/v1/routing-rules/:id | routing-rules | Session/Key | routing:write | yes | IMPLEMENTED | Delete |

### automation — scoring / dedup / enrichment (`automation/automation.controller.ts`)

| Method | Endpoint | Module | Auth | Permission | Tenant Scoped | Status | Purpose |
|---|---|---|---|---|---|---|---|
| GET | /api/v1/automation/scoring | automation | Session/Key | scoring:read | yes | IMPLEMENTED | Rule-set versions list (**unbounded**, H-8) |
| POST | /api/v1/automation/scoring | automation | Session/Key | scoring:write | yes (actor) | IMPLEMENTED | Create new immutable version (201; siblings disabled) |
| PATCH | /api/v1/automation/scoring/:id | automation | Session/Key | scoring:write | yes | IMPLEMENTED | Enable/disable one set |
| GET | /api/v1/automation/dedup | automation | Session/Key | dedup:read | yes | IMPLEMENTED | Read config — **lazily creates default row on first GET** (unaudited write, H-7) |
| PUT | /api/v1/automation/dedup | automation | Session/Key | dedup:write | yes (key=tenantId) | IMPLEMENTED | Full-replace config (strategy, matchFields, enabled), audited |
| GET | /api/v1/automation/enrichment | automation | Session/Key | enrichment:read | n/a | **PARTIAL** | Honest status stub `{implemented:false, providers:[], note}` — enrichment stage runs SKIPPED in worker |

### deliveries (`deliveries/deliveries.controller.ts`)

| Method | Endpoint | Module | Auth | Permission | Tenant Scoped | Status | Purpose |
|---|---|---|---|---|---|---|---|
| GET | /api/v1/deliveries/queue-stats | deliveries | Session/Key | deliveries:read | **NO (global)** | IMPLEMENTED | BullMQ counts per queue + DLQs — all tenants (aggregate visibility, H-1a) |
| GET | /api/v1/deliveries/dead-letter | deliveries | Session/Key | deliveries:read | **NO (global)** | **BROKEN** | DLQ jobs incl. `job.data` (tenantId, leadId, payload) of **every tenant** → cross-tenant leak (H-1) |
| GET | /api/v1/deliveries/failed | deliveries | Session/Key | deliveries:read | **NO (global)** | **BROKEN** | Failed queue jobs incl. `job.data` — same cross-tenant leak (H-1). Query not zod-validated |
| GET | /api/v1/deliveries | deliveries | Session/Key | deliveries:read | yes | IMPLEMENTED | List (status/destinationId/**leadId**, cursor) |
| GET | /api/v1/deliveries/:id | deliveries | Session/Key | deliveries:read | yes | IMPLEMENTED | Detail + immutable `DeliveryAttempt` history (attemptNumber, replayCycle, replayCount, cycleStartAttempt) |
| POST | /api/v1/deliveries/:id/replay | deliveries | Session/Key | deliveries:retry | yes | IMPLEMENTED | Append-only replay: new cycle (+5 maxAttempts); **409** when PENDING/QUEUED/IN_PROGRESS/SUCCEEDED; 201 `{queued:true}`, audited |

### imports (`imports/imports.controller.ts`)

| Method | Endpoint | Module | Auth | Permission | Tenant Scoped | Status | Purpose |
|---|---|---|---|---|---|---|---|
| POST | /api/v1/imports | imports | Session/Key | imports:write | yes (actor) | IMPLEMENTED | multipart/csv upload (field `file`, 50 MB) + `sourceId`; enqueues `csv-import` (201); async |
| GET | /api/v1/imports | imports | Session/Key | imports:read | yes | IMPLEMENTED | Job list (status filter, cursor) |
| GET | /api/v1/imports/:id | imports | Session/Key | imports:read | yes | IMPLEMENTED | Job detail/progress — **returns `storageKey` + `checksum`** (H-9); **no consumer** (§E) |
| GET | /api/v1/imports/:id/errors | imports | Session/Key | imports:read | yes | IMPLEMENTED | CSV error report (`text/csv`, envelope bypassed via `@SkipTransform`, ≤10k rows); audited download |

### analytics (`analytics/analytics.controller.ts`)

| Method | Endpoint | Module | Auth | Permission | Tenant Scoped | Status | Purpose |
|---|---|---|---|---|---|---|---|
| GET | /api/v1/analytics/overview | analytics | Session/Key | analytics:read | yes | IMPLEMENTED | DB-aggregated KPIs (counts, rates) |
| GET | /api/v1/analytics/timeseries | analytics | Session/Key | analytics:read | yes | IMPLEMENTED | Daily series (days 1–90, SQL group-by) |
| GET | /api/v1/analytics/sources | analytics | Session/Key | analytics:read | yes | IMPLEMENTED | Per-source performance (groupBy) |
| GET | /api/v1/analytics/destinations | analytics | Session/Key | analytics:read | yes | IMPLEMENTED | Per-destination performance — **loads all tenant delivery rows in JS** (H-8 hot spot) |
| GET | /api/v1/analytics/pipeline | analytics | Session/Key | analytics:read | yes | IMPLEMENTED | Stage funnel |

### health (`health/health.controller.ts`)

| Method | Endpoint | Module | Auth | Permission | Tenant Scoped | Status | Purpose |
|---|---|---|---|---|---|---|---|
| GET | /api/v1/health | health | Public (300/min) | — | n/a | **PARTIAL** | Checks PG (`SELECT 1`) + Redis; **no worker check; returns HTTP 200 with `status:"degraded"` + raw driver errors when down** (H-10) |

---

## B. PARTIAL APIs

| Endpoint | What works | What's missing |
|---|---|---|
| GET /api/v1/automation/enrichment | Honest `{implemented:false, note}` status | No providers, no config, no execution — worker stage is an explicit no-op (`apps/worker/src/pipeline/pipeline.service.ts:423-446`) |
| GET /api/v1/health | API+PG+Redis liveness with latency | No worker/BullMQ-consumer liveness; failure → HTTP 200 not 503; raw error strings leaked |
| POST /api/v1/imports (cancel half of the contract) | Worker honors `CANCELLED` status (`csv-import.processor.ts:41`), enum exists | **No `POST /imports/:id/cancel` endpoint** — half the stack supports it (see G) |

---

## C. MISSING APIs

Full analysis with rationale in **`docs/api-gaps.md`**. Summary:

| Priority | Endpoint | Domain | Evidence it's needed |
|---|---|---|---|
| **Required now** | POST /api/v1/auth/change-password | auth | `changePasswordSchema` already shipped unused (`packages/validation/src/index.ts:283`) |
| **Required now** | POST /api/v1/imports/:id/cancel | imports | `CANCELLED` enum + worker check already exist |
| **Required (schema first)** | Source activation/deactivation (`status` on PATCH /api/v1/sources/:id) | sources | Requested capability; `LeadSource` lacks any status column — no endpoint or schema support exists |
| Recommended | GET /api/v1/users/:id | users | UI can only list; detail requires client-side scan |
| Recommended | DELETE /api/v1/users/:id | users | Only status-DISABLED exists today |
| Recommended | GET /api/v1/audit-logs/:id | audit-logs | Pagination contract has no single-row fetch |
| Recommended | POST /api/v1/webhooks/events/:id/replay *or* documented provider-retry story | webhooks | FAILED events recoverable only by provider re-send |
| Planned | POST /auth/forgot-password, /auth/reset-password | auth | Needs mailer infra first (none exists) |
| Planned | OAuth authorize/callback/token-refresh per integration | integrations | Today: manually pasted static credentials only |
| Planned | Tenant CRUD (GET/POST/GET/PATCH/DELETE /tenants/:id) + activate/deactivate | tenants | Only `/tenants/me`; needed only for a super-admin console |
| Not required | Bulk import/update/replay, export, /leads PATCH, deliveries cancel, analytics/deliveries, analytics/queue, field-mapping preview/discovery, routing simulation, /health (unprefixed) | — | No architecture/UI consumes these; see api-gaps.md §"Explicitly not required" |

---

## D. DUPLICATE APIs

**None found.** Candidate pairs examined and confirmed distinct:

| Candidate | Verdict |
|---|---|
| POST /leads/:id/replay vs POST /deliveries/:id/replay | **Not duplicates** — lead-level re-runs the whole pipeline; delivery-level appends an attempt cycle to one destination |
| /deliveries/failed (queue view) vs /deliveries?status=FAILED (delivery rows) | Different resources: BullMQ job state vs DB delivery rows. Both feed distinct UI pages |
| /roles/permissions vs a hypothetical /permissions | The catalog endpoint is the canonical permissions API; a second path would duplicate it |
| /sources/accounts/:accountId (flat) vs /sources/:id/accounts/:accountId (nested) | **Nesting inconsistency, not duplication** — see §Naming |
| /webhooks/inbound/:publicId vs domain's /webhooks/:source/:publicId | Single generic ingress by design; source is encoded in the account's publicId. Canonical as-is |

Canonical choices to preserve: **replay** (never a separate `/retry` route), **/leads** plural, **/automation/{scoring,dedup,enrichment}** grouping.

---

## E. UNUSED APIs (implemented, zero consumers)

Verified against apps/web (69 call templates), `scripts/*` (no API calls at all — only the local e2e sink server), and tests (no HTTP calls — services are driven directly). 11 routes have **no consumer anywhere**:

| Endpoint | Likely reason | Verdict |
|---|---|---|
| POST /imports, GET /imports, GET /imports/:id, GET /imports/:id/errors | CSV upload UI never built | Keep — core product feature, wire UI later |
| GET /webhooks/events, GET /webhooks/events/:id | No event-log UI | Keep — add to Sources page later |
| DELETE /leads/:id | No delete affordance in lead UI | Keep — deliberate caution |
| GET /sources/:id | Web only lists + fetches accounts | Keep — cheap detail route |
| PATCH /sources/accounts/:accountId | Accounts are create/delete/rotate only in UI | Keep |
| GET /destinations/:id/health | UI uses `/test` instead | Keep — passive health vs active probe |
| POST /auth/register | No signup page (registration done via API/E2E) | Keep — bootstrap + future self-serve |

Dead **frontend** code (not endpoints): `useCreateLead` (`apps/web/src/lib/queries/leads.ts:142`) and `useDelivery` (`queries/delivery.ts:37`) are never invoked; `requestBlob` and `webhookUrl` exports unused.

---

## F. BROKEN APIs

| Endpoint | Breakage | Evidence |
|---|---|---|
| GET /api/v1/deliveries/dead-letter | Returns `job.data` (tenantId, leadId, payload) for **all tenants** to any `deliveries:read` holder | `deliveries.service.ts:117-132`, `infra/redis.module.ts:215-256` |
| GET /api/v1/deliveries/failed | Same cross-tenant leak | same |

Related-but-implemented (flagged, not broken): queue-stats is global by design of BullMQ counters (H-1a).

Contract deviations on working endpoints (documented in OpenAPI as-is): webhook ingress returns **201** where code comments say 202; lead replay returns `{replayed}` where web types say `{queued}` (§I).

---

## G. REQUIRED APIs (product-complete checklist)

| Domain | Required by product | Status |
|---|---|---|
| Auth: register/login/logout/refresh/me | yes | ✅ implemented |
| Auth: change-password | yes | ❌ missing (schema ready) |
| Auth: forgot/reset-password | only with email infra | ⏸ planned |
| Tenants: me (+rename) | yes | ✅ |
| Tenants: CRUD/activate/limits/usage | only with admin console | ⏸ planned |
| Users: list/create/update(activation,role) | yes | ✅ |
| Users: detail/delete | recommended | ❌ missing |
| Roles: CRUD + permission catalog | yes | ✅ (detail = list) |
| Leads: list/create/detail/timeline/payloads/replay/delete | yes | ✅ |
| Leads: filter/search/pagination/sort | yes | ✅ (cursor + filters; no server sort — newest-first by design) |
| Sources: CRUD + accounts + webhook URL + secret rotation | yes | ✅ |
| Sources: activation/deactivation | yes (requested capability) | ❌ MISSING — `LeadSource` has **no status column** (`schema.prisma:332`) and `sourceUpdateSchema` accepts only `name?/config?`; needs a schema addition first |
| Sources: test-connection/health | recommended | ❌ missing (destinations have it; sources don't) |
| Webhooks: ingress + HMAC + idempotency + rate limit + event history | yes | ✅ (201-vs-202 + optional-signature caveats) |
| Destinations: CRUD + credential + health + test | yes | ✅ |
| Integrations: OAuth flows | for hosted-credential product | ⏸ planned (static credentials today) |
| Field mappings: CRUD + versions + activate | yes | ✅ (validation/preview/discovery = optional) |
| Routing: CRUD + enable/disable | yes | ✅ (validation/simulation = optional) |
| Scoring: versions + activate/enable + calc (worker) | yes | ✅ (preview = optional) |
| Dedup: config + strategies + duplicate surfacing | yes | ✅ (merge intentionally **not** supported — links, never merges) |
| Enrichment: providers/execution | only when provider exists | ⏸ stub, honestly reported |
| Deliveries: list/detail/attempts/replay | yes | ✅ replay semantics verified (append-only attempts, +5 cycles) |
| Deliveries: cancel | no (replay+DLQ model) | ➖ not required |
| Queue: health/counts/failed/DLQ read | yes | ⚠ implemented but BROKEN scoping (F) |
| Queue: admin ops (pause/flush/rotate) | no — must stay unexposed | ➖ correctly absent |
| Imports: create/list/detail/errors + async processing | yes | ✅ |
| Imports: cancel | yes (enum+worker ready) | ❌ missing endpoint |
| Audit: list (+filters/pagination) | yes | ✅ (GET /:id optional) |
| Analytics: overview/leads(sources,destinations)/queue via overview+queue-stats | yes | ✅ (dedicated /analytics/deliveries + /analytics/queue not needed) |
| Health: API/PG/Redis/Worker distinction, non-200 when degraded | yes | ⚠ partial (H-10) |

---

## H. SECURITY FINDINGS (summary)

Full detail with evidence in **`docs/api-security-audit.md`**. Severity-ordered:

| ID | Sev | Finding |
|---|---|---|
| H-1 | **High** | Cross-tenant read: `/deliveries/dead-letter` + `/failed` return other tenants' `job.data` (also exposes tenantId/leadId); `/queue-stats` is global aggregate |
| H-2 | **High** | `POST /api-keys` with default `scopes: []` ⇒ `permissions:["*"]` ⇒ bypasses every `@RequirePermission` |
| H-3 | Med-High | Access tokens survive logout/revocation (guard never consults `UserSession`; exposure ≤ JWT_ACCESS_TTL 900 s) |
| H-4 | Medium | Disabled user's API keys keep working (key path never loads owning user) |
| H-5 | Medium | `POST /leads` ignores Idempotency-Key; without `externalLeadId` no dedup possible → duplicate rows on retry |
| H-6 | Low-Med | Webhook ingress documented as 202, actually 201; unsigned traffic accepted when account has no secret (unless `requireSignature`) |
| H-7 | Low | Unaudited writes: `GET /automation/dedup` lazy-create; `POST /auth/logout` |
| H-8 | Medium | 6 unbounded `findMany` lists (sources, source accounts, destinations, roles, routing-rules, scoring versions) + `analytics/destinations` loads every delivery row; 9 other lists correctly cursor-paginated |
| H-9 | Low | `GET /imports/:id` leaks `storageKey`+`checksum`; refresh token returned in JSON body (also httpOnly cookie); `/imports/:id`... health exposes raw driver errors; `/leads/:id/payloads` unsanitized |
| H-10 | Low | Health = HTTP 200 even when degraded; no worker liveness |

Positives verified: tenant never taken from client input (credential-derived only); 73/78 non-public routes permission-guarded; secrets AES-256-GCM/bcrypt/SHA-256 at rest and select-filtered from responses; timing-safe webhook HMAC over raw body; SSRF-guarded egress with DNS-rebinding-safe private-IP checks; audit rows on ~40 mutation sites with secret stripping; no stack traces in responses; correlation IDs on every response.

---

## I. FRONTEND / API MISMATCHES

| # | Frontend believes | Backend does | Impact |
|---|---|---|---|
| 1 | `POST /leads` body `{sourceAccountId?, externalLeadId?, payload}` (`queries/leads.ts:145`) | `{sourceId, sourceAccountId (both required), externalLeadId?, data}` (`leads.dtos.ts:8-13`) | Would 400 — currently unreachable (hook is dead code) |
| 2 | Lead replay response `{queued:boolean}` (`queries/leads.ts:132`) | `{replayed:boolean}` (`leads.service.ts:250`) | Type-only today; value discarded by caller |
| 3 | "Retry at" column = next retry (`delivery/retry/page.tsx:58`, `queue-jobs-table.tsx:78`) | `retryAt` is filled from **job creation timestamp** (`infra/redis.module.ts:251`) | Misleading data on Retry page |
| 4 | — | — | Coverage itself is healthy: **69/69 calls match real routes**, no wrong HTTP methods, no calls to missing endpoints; all list envelopes `{items,nextCursor,total}` are supersets of what web reads |

---

## J. RECOMMENDED API ARCHITECTURE

Detailed in **`docs/api-architecture.md`**. Summary:

1. Keep the current shape: `/api/v1`, single Nest app, zod DTOs (`createZodDto`), `{success,data}` envelope, cursor pagination, guard chain. It is coherent and mostly complete — **fix, don't re-platform**.
2. Fix H-1/H-2 before any external exposure; add change-password + import cancel (schemas/enums already exist).
3. Introduce a `TenantQueueView` (filter job.data by actor tenant) or drop job payloads from queue endpoints; scope queue-stats per tenant.
4. Standardize list endpoints: either paginate the 6 unbounded lists or document them as bounded reference data with an explicit `take`.
5. Make webhooks honor 202 (or update the documented contract), and default new accounts to `requireSignature=true`.
6. Decide the missing-endpoint set from §C with product input; do **not** add OAuth/tenants-CRUD until their consumers exist.
7. Generate OpenAPI from the app (enable the already-installed `@nestjs/swagger` document builder — decorators are present but no document is registered) so `docs/openapi.yaml` becomes a build artifact, not hand-maintained.
8. Add HTTP-surface tests (supertest) for auth, RBAC, tenant isolation, idempotency, rate limits, 404/409 — today zero controller tests exist.

---

## Appendix 1 — Conventions verified

- **Versioning:** 100% `/api/v1/...`; no unversioned or mixed paths (`main.ts:49-50`; no `@Version()` overrides).
- **Naming:** plural kebab-case resources everywhere (`/routing-rules`, `/field-mappings`, `/api-keys`); no verb-style routes. Inconsistencies: flat `/sources/accounts/:accountId` (vs nested siblings), `/automation/*` grouping vs top-level `/routing-rules`, `/tenants/me` instead of `/tenants/:id`.
- **Status codes:** Nest defaults (POST→201, others→200); no `@HttpCode` anywhere. 400 validation (zod via nestjs-zod), 422 service-level ZodError, 401/403/404/409 (Prisma P2002/P2025 mapped), 429 throttled, 503 queue-down, 500 generic. No 200-for-failure except health (H-10).
- **Idempotency-Key:** never read (grep=0). Real idempotency exists via DB uniques: webhook events, lead external ids, delivery identity, attempt numbers, outbound `Idempotency-Key` header to destinations.
- **Rate limits:** global 300/min; auth register/login/refresh 20/min; webhook ingress 600/min; nothing skipped.
- **Untyped public contracts (violations of §5):** `webhooks/events` query (inline TS type), `deliveries/dead-letter|failed` query params (raw strings), webhook ingress body (`unknown` — intentional), analytics handler DTOs inline. Everything else flows through zod DTOs.

## Appendix 2 — Test coverage of API surface

- **HTTP-layer tests: zero** (`apps/api/src/**/*.spec.ts` = none; no supertest, no playwright despite `test:e2e` script).
- Indirect coverage exists: tenant-isolation (`tests/integration/tenant-isolation.test.ts`), DB idempotency (`idempotency.test.ts`), pipeline/replay/audit (`pipeline`, `replay`, `audit`), queue mechanics + signed-webhook e2e (`tests/queue/*`).
- Untouched by any test: auth, tenants, users, roles, api-keys, destinations, field-mappings, imports, analytics, health, automation endpoints, and all controllers' HTTP behavior (validation, status codes, rate limits).
