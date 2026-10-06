# API Gaps Analysis — Lead Integration & Distribution Middleware

**Audit date:** 2026-10-01 · Companion to `docs/api-inventory.md` §B/§C/§G. **Nothing has been implemented — this is the decision document for your review.**

Each gap states: what's asked for → what exists → what's actually needed for *this* product's architecture → recommendation. The guiding rule used throughout: **do not add an endpoint whose consumer (UI/worker/integration) does not exist in the architecture.**

---

## 1. Authentication

| Requested endpoint | Exists? | Architecture reality | Recommendation |
|---|---|---|---|
| POST /api/v1/auth/register | ✅ | Creates tenant+admin+roles in one tx | Keep |
| POST /api/v1/auth/login | ✅ | JWT access (900 s) + rotating refresh cookie | Keep |
| POST /api/v1/auth/logout | ✅ | Revokes session server-side | Keep (add audit row — security H-7) |
| POST /api/v1/auth/refresh | ✅ | Rotation + reuse detection | Keep |
| GET /api/v1/auth/me | ✅ | Web bootstrap incl. permissions | Keep |
| POST /api/v1/auth/change-password | ❌ **MISSING** | `changePasswordSchema` (12+ chars, upper/lower/digit) **already exported** at `packages/validation/src/index.ts:283` but no controller uses it; `userUpdateSchema` does not accept a password either | **REQUIRED** — half-built already; implement next |
| POST /api/v1/auth/forgot-password | ❌ | **No mailer/sms infra anywhere** (config has no SMTP/provider keys) | **PLANNED** — blocked on email infrastructure; a token would need a `PasswordResetToken` model (schema change) |
| POST /api/v1/auth/reset-password | ❌ | Same blocker | **PLANNED** with forgot-password |

**Gaps found beyond the requested list:**
- Logout/refresh rotation never invalidates already-issued **access** tokens (see security H-3). No endpoint can fix this alone — needs guard-level session check or short-TTL discipline.
- No `POST /auth/sessions` (list active sessions) — optional; model `UserSession` already stores them.

---

## 2. Tenants

| Requested | Exists? | Architecture reality | Recommendation |
|---|---|---|---|
| GET/POST /tenants, GET/PATCH/DELETE /tenants/:id | ❌ (only `/tenants/me` GET+PATCH) | Tenants are created by **registration**; the product UI is single-workspace-per-login. There is no super-admin console, no cross-tenant operator | **NOT REQUIRED now.** If an admin console is planned: PLANNED |
| activate/deactivate tenant | ❌ | `Tenant.status` (SUSPENDED) exists and the guard already enforces 403 for suspended tenants (`jwt-auth.guard.ts:91`) — but nothing can set it | PLANNED with tenants-CRUD |
| settings | ✅ via PATCH /tenants/me | name only; slug immutable | Enough for current UI |
| integrations / usage / limits | ❌ | No usage-metering or limit columns in schema | **NOT REQUIRED** — no billing/limits feature exists; do not invent |

---

## 3. Users

| Requested | Exists? | Notes | Recommendation |
|---|---|---|---|
| GET /users | ✅ cursor | Includes role + counts | — |
| POST /users | ✅ | bcrypt, role assignment | — |
| GET /users/:id | ❌ | UI shows detail only via list scan (25/page) | **RECOMMENDED** — trivial, completes REST shape |
| PATCH /users/:id | ✅ | name/role/**status** (activate/deactivate built-in) | — |
| DELETE /users/:id | ❌ | Deactivation exists (DISABLED); hard delete doesn't | RECOMMENDED — decide product semantics: deactivation-only (GDPR soft) vs hard delete; audit row required |
| password (admin reset) | ❌ | — | Fold into change-password work (admin-set-temporary-password flow) |
| roles/permissions per user | ✅ | returned inside `/users` rows (role.permissions) | No separate `/users/:id/permissions` needed — `GET /auth/me` covers self, roles cover others |

---

## 4. Roles & permissions

| Requested | Exists? | Notes | Recommendation |
|---|---|---|---|
| GET/POST/PATCH/DELETE /roles | ✅ | System roles (admin/manager/developer/viewer) immutable; 409 when in use | — |
| GET /roles/:id | ❌ | List already returns full permission arrays for every role | **NOT REQUIRED** (list is the detail) — or add for REST purity |
| GET /permissions | ✅ as `GET /roles/permissions` | 34-code catalog + templates | Canonical as-is; don't duplicate path |
| GET /users/:id/permissions | ❌ | Redundant with role.permissions | NOT REQUIRED |

---

## 5. Leads

| Requested | Exists? | Notes | Recommendation |
|---|---|---|---|
| GET/POST/GET :id/DELETE :id | ✅ | | — |
| PATCH /leads/:id | ❌ | Leads are pipeline-managed documents; the architecture never mutates lead content after intake (replay re-derives it) | **NOT REQUIRED** — adding it would break the immutability story |
| POST /leads/:id/replay | ✅ | leads:replay, audited, returns `{replayed}` | Fix web's `{queued}` type (mismatch I-2) |
| GET /leads/:id/timeline | ✅ | Stage events | — |
| GET /leads/:id/deliveries | ✅ effectively | `GET /leads/:id` embeds deliveries; `GET /deliveries?leadId=` exists as a dedicated filter (`deliveryListQuerySchema` line 68) | NOT REQUIRED as separate path |
| GET /leads/:id/audit | ✅ effectively | `GET /audit-logs?entityId=:id` (web already does this, `queries/leads.ts:121`) | NOT REQUIRED as separate path |
| bulk import | ✅ via /imports | CSV path is the bulk path | — |
| bulk update / bulk replay | ❌ | No UI concept | NOT REQUIRED |
| search | ⚠ partial | Filter-based (status/source/destination/date) but **no free-text search** | Decide: if lead UI needs keyword search, add `q` param to existing list (server-side ILIKE over canonical fields) — RECOMMENDED small enhancement, no new endpoint |
| export | ❌ | | NOT REQUIRED (imports error-CSV precedent exists if needed) |
| sorting | ⚠ | Newest-first fixed | Acceptable; add `order` only if users ask |

---

## 6. Lead sources

| Requested | Exists? | Notes | Recommendation |
|---|---|---|---|
| CRUD | ✅ | `PATCH /sources/:id` accepts **name/config only** (`sourceUpdateSchema`, `validation/index.ts:195-198`) | — |
| source activation/deactivation | ❌ **MISSING (capability does not exist)** | `LeadSource` has **no status column** (`prisma/schema.prisma:332`) — no endpoint, no field, nothing to activate/deactivate. (The `status: ACTIVE\|DISABLED` enum belongs to **destinations**, `validation/index.ts:215`.) | **REQUIRED per product domain spec — needs schema change first:** add `LeadSource.status`, accept it in `PATCH /sources/:id`, audit the toggle. Reported only; not implemented (audit rule + schema-change prohibition) |
| source accounts (credentials) | ✅ | create/list/delete + `rotate-secret`; secrets returned once, AES-GCM at rest | — |
| webhook configuration | ✅ | per-account `publicId` → `POST /webhooks/inbound/:publicId`; URL shown in `GET /sources/:id/accounts` | — |
| source health / test connection | ❌ | Destinations have `/health` + `/test`; sources have neither. Inbound sources don't need outbound probes, but a **webhook-received-last / failure-count** health view could reuse `WebhookEvent` stats | OPTIONAL — if built, prefer read-only computed health over a new probe endpoint |
| Google Ads / Meta / LinkedIn-specific handlers | ❌ | Architecture has **one generic signed ingress**, no per-provider verification (grep: no META/GOOGLE signatures) | PLANNED only if those integrations become a product goal — each needs provider-specific signature verification + payload normalizer, not just an endpoint |
| CSV as source | ✅ via /imports | `sourceId` required on upload | — |

---

## 7. Webhooks

| Requested | Exists? | Notes | Recommendation |
|---|---|---|---|
| POST /webhooks/:source/:publicId | ✅ as `/webhooks/inbound/:publicId` | Source is encoded in the account (publicId maps to source+tenant) — the `:source` segment would be redundant | Canonical as-is |
| registration | ✅ | Creating a source account registers the webhook (publicId issued) | — |
| verification | ✅ | Public account URL is the caller capability; no per-request HMAC/JWT is required for generic intake. Legacy credentials remain encrypted but do not gate webhook requests | Add provider-origin verification only for provider-specific push protocols that require it |
| secret management | ⚠ | Legacy rotate-secret endpoint remains for compatibility; new inbound accounts do not generate signing secrets | Keep secrets out of the integration UI; retire legacy endpoint after migration window |
| event history | ✅ | `GET /webhooks/events[/:id]` (filter status/account/cursor) — **no UI consumer yet** | Wire UI later; add zod DTO for the inline query type |
| failed webhook events | ⚠ | `FAILED` events exist; **resume path already recovers them when the provider retries** (duplicate → reset to RECEIVED) | Document "provider retry = replay". Optional internal `POST /webhooks/events/:id/replay` if operators want manual replay — RECOMMENDED only if event UI ships |
| rate limiting | ✅ | 600/min per IP on ingress | — |
| payload validation | ✅ | JSON payload is normalized from common aliases/provider field arrays; configured required fields fail with `LEAD_VALIDATION_FAILED` before persistence | Extend aliases when new provider formats are encountered |

---

## 8. Destinations

| Requested | Exists? | Notes | Recommendation |
|---|---|---|---|
| CRUD + activate/deactivate | ✅ | `status` in update schema; `DestinationStatus` enum | — |
| credentials | ✅ | PUT/DELETE `/destinations/:id/credential`, write-only, AES-GCM | — |
| health | ✅ | `GET /:id/health` (stored probe) — no UI consumer | Wire UI later |
| test connection | ✅ | `POST /:id/test` real SSRF-guarded probe, audited | — |
| configuration by type | ✅ | `GET /destinations/types` + type-specific zod config | — |
| Salesforce/HubSpot/Zoho/Pipedrive/DCT-CRM/webhook/custom REST | ✅ adapters | All 7 `DestinationType`s implemented in `packages/integrations` | — |

---

## 9. Integrations (OAuth)

| Requested | Exists? | Architecture reality | Recommendation |
|---|---|---|---|
| OAuth authorize / callback / token refresh endpoints | ❌ | Credentials are **manually pasted static secrets**; adapters use stored values. No OAuth client registrations, no redirect URIs, no token vault columns for provider access/refresh tokens (only `IntegrationCredential.secret` single blob) | **PLANNED** — significant work: new models (provider auth code, access+refresh token, expiry), callback route (must escape `/api/v1` semantics or live under it), state/CSRF, refresh scheduling. Do not scaffold until a hosted-credential UX is approved |
| integration status/disconnect | ✅ effectively | credential presence (`stored:true`) + health/test | Sufficient today |
| "never expose credentials in responses" | ✅ verified | Selects exclude secrets; only `stored:true` flags | — |

---

## 10. Field mapping

| Requested | Exists? | Notes | Recommendation |
|---|---|---|---|
| GET/POST/DELETE /field-mappings | ✅ | tenant-unique name per destination | — |
| GET /field-mappings/:id | ✅ | incl. versions | — |
| PATCH /field-mappings/:id | ❌ | **By design**: edits append an immutable version (`POST /:id/versions`) + `POST /:id/activate` | NOT REQUIRED — versioning supersedes PATCH; document rationale |
| mapping validation | ⚠ | Server validates field schema (zod `fieldMappingFieldSchema`, 13 transforms) but no "dry-run against a sample lead" | OPTIONAL preview endpoint |
| mapping preview | ❌ | | PLANNED (nice UX, needs sample payload input) |
| versions / publish | ✅ | create-version + activate (=publish), rollback = activate older | — |
| destination field discovery | ❌ | Would require provider metadata APIs per adapter | PLANNED with OAuth work |

---

## 11. Routing rules

| Requested | Exists? | Notes | Recommendation |
|---|---|---|---|
| GET/POST/PATCH/DELETE /routing-rules | ✅ | priority-ordered; partial PATCH supports `{enabled}` = enable/disable | — |
| GET /routing-rules/:id | ❌ | List returns complete rows | NOT REQUIRED (list = detail) |
| rule validation | ✅ at write | zod `routingRuleUpsertSchema` + condition/operator enum checks | — |
| rule ordering | ⚠ | `priority` on create/update; **no reorder endpoint** (swap via PATCH priorities) | Optional `PATCH /routing-rules/order` only if UI builds drag-and-drop |
| rule testing / preview / simulation | ❌ | Worker has `conditions.spec.ts`-verified evaluator that could be reused | OPTIONAL — a `POST /routing-rules/simulate {lead}` read-only evaluator would be genuinely useful; PLANNED |

---

## 12. Scoring

| Requested | Exists? | Notes | Recommendation |
|---|---|---|---|
| rules + configuration | ✅ | `GET/POST /automation/scoring`, `PATCH /:id` enable | — |
| score calculation | ✅ in worker | pipeline SCORING stage writes immutable `LeadScore` rows | — |
| score versions | ✅ | immutable rule sets, `@@unique([tenantId,version])`, exactly one enabled | — |
| activation/deactivation | ✅ | PATCH `{enabled}` (server enforces single-enabled via sibling disable) | — |
| score preview | ❌ | Same optional simulate concept as routing | PLANNED (one shared `/pipeline/simulate` could cover scoring+routing+dedup) |

---

## 13. Deduplication

| Requested | Exists? | Notes | Recommendation |
|---|---|---|---|
| config + strategies | ✅ | `GET/PUT /automation/dedup`, 5 strategies (`MatchedFields`), custom matchFields ≤10 | — |
| duplicate search | ✅ effectively | `GET /leads?dedupStatus=…` + `GET /leads/:id` embeds `duplicateOf` | — |
| duplicate relationships | ✅ stored | `LeadDuplicate` rows (strategy, confidence, originalLeadId) shown in lead detail | — |
| merge / review | ❌ | **Product deliberately links, never merges** ("duplicates kept and linked — never silently dropped") | **NOT REQUIRED** — do not invent merge semantics. If review workflows are wanted later: a `LeadDuplicate.status (REVIEWED/DISMISSED)` field would be the minimal additive change (schema change — not in this audit) |
| lazy-create side effect | ⚠ | `GET /automation/dedup` writes the default row on first read (unaudited, H-7) | Fix behavior, not the endpoint |

---

## 14. Enrichment

| Requested | Exists? | Notes | Recommendation |
|---|---|---|---|
| providers / configuration / execution / retry / health | ❌ (status stub only) | Worker stage writes `{skipped:true, reason:"No enrichment provider is configured…"}` and marks stage **SKIPPED** — honest, tested behavior (`pipeline.service.ts:423-446`); API returns `implemented:false` | **PLANNED as a whole domain.** Required endpoints when a provider is chosen: `GET/PUT /automation/enrichment` (config), provider health within status, execution stays in the worker stage, retry rides existing lead replay. Keep the honest stub until then |

---

## 15. Deliveries

| Requested | Exists? | Notes | Recommendation |
|---|---|---|---|
| GET /deliveries, GET /:id | ✅ | detail embeds immutable `DeliveryAttempt[]` | — |
| POST /:id/replay | ✅ | append-only: global attempt numbering, `replayCycle`, +5 `maxAttempts` per cycle, 409 guards, audited — regression-tested (`tests/integration/replay.test.ts`) | — |
| GET /deliveries/dead-letter | ⚠ BROKEN | cross-tenant leak (F/H-1) | **Fix scoping before anything else** |
| retry | ✅ = replay | Canonical single mechanism | Never add a second `/retry` route |
| cancel | ❌ | Replay + DLQ model has no cancel concept; a cancel would need worker cooperation for in-flight jobs | **NOT REQUIRED** (revisit if users ask to stop a queued delivery) |
| attempts / timeline / failure reason / destination response | ✅ | in detail payload (attempt rows carry status, error, response snippet, replayCycle) | — |
| queue status | ⚠ | see Queue section | Fix scoping |

---

## 16. Queue

| Requested | Exists? | Notes | Recommendation |
|---|---|---|---|
| GET /api/v1/health | ✅ PARTIAL | PG+Redis only, 200-when-down, no worker | **REQUIRED fix:** add worker/BullMQ liveness, return 503 on failed critical checks (or document degraded contract loudly) |
| GET /health (unprefixed) | ❌ | No deploy manifests exist yet (no Docker/k8s) | Add only when a deployment target needs a probe path |
| GET /deliveries/queue-stats | ✅ | waiting/active/completed/failed/delayed per queue + DLQs | Scope or explicitly document as operator-global (H-1) |
| active/failed/delayed job reads | ✅ | `/deliveries/failed`, `/deliveries/dead-letter` | Fix scoping (H-1) |
| queue admin (pause/flush/purge) | ❌ **intentionally** | "Never expose unsafe queue administration to normal users" | **Must remain absent** from the public API |

---

## 17. CSV import

| Requested | Exists? | Notes | Recommendation |
|---|---|---|---|
| POST /imports | ✅ | multipart, 50 MB cap, async enqueue, tenant-validated source | — |
| GET /imports, GET /:id | ✅ | status counters/progress in detail | — |
| POST /imports/:id/cancel | ❌ **MISSING** | `ImportJobStatuses` includes `CANCELLED`; worker already aborts on it (`csv-import.processor.ts:41`) — **only the endpoint is absent** | **REQUIRED** — cheapest gap on this list; also audit the cancellation |
| upload validation/preview | ⚠ | Validation happens in the worker (row errors persisted); **no pre-flight preview** | Optional: `POST /imports/preview` (first N rows parsed synchronously) — PLANNED |
| result download | ✅ | `GET /:id/errors` CSV (≤10k rows, audited) | — |
| retry failed import | ❌ | Re-upload is the current path (deterministic externalLeadId makes re-upload idempotent) | Acceptable; optional `POST /:id/retry` later |

---

## 18. Audit logs

| Requested | Exists? | Notes | Recommendation |
|---|---|---|---|
| GET /audit-logs | ✅ | filters: action/entityType/entityId/actor/from/to; cursor; metadata sanitized (secret-stripping) | — |
| GET /audit-logs/:id | ❌ | | OPTIONAL (list+entityId filter suffices) |
| verification checklist | ✅/⚠ | tenant-scoped ✅, pagination ✅, actor ✅, action ✅, entity ✅, timestamp ✅, correlationId ✅. Secrets: `sanitizeDeep` strips token/secret/password keys ✅ | Watch: `HttpException` messages pass through verbatim — review before adding user-facing error messages |

---

## 19. Analytics

| Requested | Exists? | Notes | Recommendation |
|---|---|---|---|
| GET /analytics/overview | ✅ | SQL aggregation | — |
| GET /analytics/leads | ✅ effectively | overview + `timeseries?days=` + pipeline funnel | Dedicated path NOT REQUIRED |
| GET /analytics/sources | ✅ | groupBy | — |
| GET /analytics/destinations | ✅ | **implementation loads all tenant deliveries into JS** (H-8 hot spot) | Fix implementation (SQL group-by), not the contract |
| GET /analytics/deliveries | ❌ | Succeeded/failed counts live in overview | NOT REQUIRED |
| GET /analytics/queue | ❌ | Covered by `/deliveries/queue-stats` | NOT REQUIRED |
| browser-side computation | ✅ verified | All aggregates are DB-side | — |

---

## 20. Explicitly NOT required (with reasons)

| Candidate | Why not |
|---|---|
| Tenant CRUD + usage/limits | No admin console, no billing/metering feature |
| OAuth endpoints | Manual-credential architecture; needs data model first |
| Lead PATCH / bulk ops / export | Pipeline-immutability design; no UI |
| Merge duplicates | Product links, never merges (tested invariant) |
| Deliveries cancel / queue admin | Replay+DLQ model; safety requirement to NOT expose |
| /users/:id/permissions, /roles/:id | Data already embedded in list/me responses |
| /leads/:id/deliveries, /leads/:id/audit | Covered by embedded detail + `?leadId=`/`?entityId=` filters |
| Unprefixed /health | No deployment target yet |
| Forgot/reset password | Blocked on nonexistent mail infrastructure |
| Per-provider webhook handlers (Meta/Google/LinkedIn) | Product currently promises one generic signed endpoint |

---

## Priority queue (for your approval)

1. **Security fixes first (no new endpoints):** H-1 queue tenant scoping, H-2 API-key wildcard scopes, H-4 disabled-user keys, H-6 signature default.
2. **Two cheap required endpoints:** `POST /auth/change-password` (schema ready), `POST /imports/:id/cancel` (enum+worker ready).
3. **Contract cleanups:** webhook 202-vs-201 decision, health 503/worker check, `retryAt` semantics, dead web hooks (`useCreateLead`/`useDelivery`), untyped query params (zod for `/webhooks/events`, `/deliveries/failed|dead-letter`).
4. **REST completeness:** `GET/DELETE /users/:id`, `GET /audit-logs/:id` (optional).
5. **Pagination hardening:** bound the 6 unbounded lists; SQL-ify `analytics/destinations`.
6. **Planned domains (separate approvals):** password reset (needs mailer), OAuth, enrichment providers, tenants-CRUD admin console, import preview, pipeline simulate.
