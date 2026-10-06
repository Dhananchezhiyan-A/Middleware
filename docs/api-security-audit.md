# API Security Audit — Lead Integration & Distribution Middleware

**Audit date:** 2026-10-01 · Scope: `apps/api/src` (guards, filters, all modules), `packages/{shared,validation,types,config}`, `prisma/schema.prisma`, egress adapters. Every finding cites code. **Nothing was changed.**

Severity: **HIGH** = exploitable now by a legitimate low-privilege tenant/user · **MEDIUM** = requires specific conditions or widens blast radius · **LOW** = hygiene/defense-in-depth.

---

## Findings (severity-ordered)

### H-1 · HIGH — Cross-tenant read via queue endpoints

`GET /api/v1/deliveries/dead-letter` and `GET /api/v1/deliveries/failed` return raw BullMQ job records **including `job.data`** for **every tenant's queues** to any principal holding `deliveries:read`.

- Evidence: `apps/api/src/modules/deliveries/deliveries.controller.ts:17-36` → `deliveries.service.ts:117-132` (no tenant argument) → `apps/api/src/infra/redis.module.ts:215-256` (`data: job.data`).
- Job payloads contain `tenantId`, `leadId`, `destinationId`, canonical lead data (`packages/types/src/jobs.ts` payloads).
- Blast radius: a `viewer` in tenant A can read tenant B's lead identifiers and payloads by paging `GET /deliveries/dead-letter?queue=delivery`.
- Related: `GET /deliveries/queue-stats` exposes **global** (all-tenant) queue counters — aggregate-only, lower severity, but still tenant-unscoped visibility.
- **Fix direction (not implemented):** filter `job.data.tenantId === actor.tenantId` (drop non-matching jobs server-side) or exclude `data` from responses entirely; tag queue jobs with tenant and make stats tenant-aware, or move queue stats behind an operator-only concept.

### H-2 · HIGH — API key with default empty scopes becomes wildcard super-admin

- Evidence: `common/guards/permissions.guard.ts:31-32` honors `permission === "*"` as match-all; `common/guards/jwt-auth.guard.ts:140` maps **empty** `apiKey.scopes` → `permissions: ["*"]`; `packages/validation/src/index.ts:272-276` `apiKeyCreateSchema` defaults `scopes` to `[]`.
- Result: `POST /api-keys {"name":"x"}` (no scopes field) mints a key satisfying **all 73 permission-guarded routes**. The web UI's create dialog does not send scopes either.
- The wildcard is unreachable through roles (roles validate against the 34-code catalog: `roles.service.ts:212-217`) — this hole exists only on the API-key path.
- **Fix direction:** require non-empty scopes (explicit admin = `permissions` list or an explicit `"*"` opt-in), or default scopes to a minimal read set. Treat any existing empty-scope key as incident-worthy.

### H-3 · MEDIUM-HIGH — Access tokens survive revocation

- Evidence: JWT path in `common/guards/jwt-auth.guard.ts:69-108` verifies signature and reloads the user, but **never consults `UserSession`**; logout/refresh-reuse revoke only sessions (`modules/auth/auth.service.ts:213-218, 244-247, 255-263`).
- Impact: after "logout everywhere" (or refresh-token-reuse mass revocation), a stolen access token keeps working until `JWT_ACCESS_TTL` (default **900 s / 15 min**).
- Disabled **user** and suspended **tenant** are checked per-request ✅ — the gap is session-level revocation only.
- **Fix direction:** check `UserSession` (jti/sid claim) on the JWT path, or accept the 15-minute window explicitly (document it).

### H-4 · MEDIUM — Disabled user's API keys keep working

- Evidence: key path `jwt-auth.guard.ts:110-145` validates the key row (status/revoked/expires/tenant) but **never loads the owning user**; a DISABLED user's keys remain fully usable.
- **Fix direction:** join user status on key auth (or cascade `apiKey.status` when the user is disabled).

### H-5 · MEDIUM — `POST /leads` idempotency depends entirely on an optional field

- Evidence: `Idempotency-Key` header is never read anywhere (grep = 0; only CORS/inbound allow-lists mention it). Dedup relies on `@@unique([tenantId, sourceAccountId, externalLeadId])` (`prisma/schema.prisma:450`); `externalLeadId` is optional (`leads.dtos.ts:11`). Postgres treats NULLs as distinct → retried POSTs create duplicate leads.
- Contrast: webhook ingress **is** properly idempotent (below), and outbound delivery uses real `Idempotency-Key` + DB unique (`worker/delivery/delivery.service.ts:130,180`).
- **Fix direction:** read `Idempotency-Key` on `POST /leads` (store on the lead or an idempotency table), or require `externalLeadId` for API-created leads.

### H-6 · LOW-MEDIUM — Webhook contract deviations (status code + optional signature)

- **Status:** code comments document "respond 202" (`webhooks.service.ts:20-23`) but no `@HttpCode` exists anywhere; ingress returns **201** on first *and* duplicate deliveries.
- **Signature:** verification runs only **if the account has a secret** (`webhooks.service.ts:53-63`); secrets are auto-created only for `WEBHOOK|API|CUSTOM` source types (`sources.service.ts:170-181`). For other types without a secret, unsigned traffic is accepted unless `requireSignature: true` is set per-account (nothing sets it by default).
- What's good: HMAC-SHA256 over **raw body** (`main.ts:19`), timing-safe compare (`shared/crypto.ts:88-97`), header auto-detect (`x-signature`/`x-hub-signature-256`/`x-middleware-signature`), 600/min ingress throttle, DB idempotency unique.
- **Fix direction:** default `requireSignature=true` for all accounts with secrets, create secrets for every webhook-bearing source type, and either return 202 or correct the documented contract.

### H-7 · LOW — Uneven audit coverage on mutations

Audited ✅ (~40 sites): leads create/replay/delete, sources CRUD+accounts+rotate, destinations CRUD+credential+test, mappings versions/activate, routing, users, roles, api-keys, imports create+download, tenant rename, delivery replay, scoring/dedup, auth register/login/failure/reuse.

Not audited ❌:
- `POST /auth/logout` (session revocation) — `auth.controller.ts:91-112`.
- `POST /auth/refresh` rotation — audited only on reuse detection (`auth.service.ts:219`).
- `GET /automation/dedup` **writes** the default config row on first read (`automation.service.ts:169-173`) — a mutation on a `dedup:read` path with no audit row.
- `POST /webhooks/inbound` creates WebhookEvent+Lead — acceptable (event table is the trail), but no AuditLog actor row.

### H-8 · MEDIUM — Unbounded list responses

Cursor pagination (`take: limit+1`, default 25/max 100 via `shared/pagination.ts`) is correctly implemented on **9** lists: leads, deliveries, audit-logs, imports, users, api-keys, field-mappings, webhook-events (+ cursorQuerySchema consumers).

**No `take` at all:**

| Endpoint | Evidence |
|---|---|
| GET /sources | `sources.service.ts:51-57` |
| GET /sources/:id/accounts | `sources.service.ts:140-143` |
| GET /destinations | `destinations.service.ts:32-39` |
| GET /roles | `roles.service.ts:60-64` |
| GET /routing-rules | `routing-rules.service.ts:65-69` |
| GET /automation/scoring | `automation.service.ts:58-62` |

Plus computational hazards: `GET /analytics/destinations` loads **every** tenant delivery row into JS (`analytics.service.ts:166-169`); `analytics/sources` lists all tenant sources (`:137-145`).

Risk: slow queries + memory growth as tenants grow; mitigating factor is per-tenant scoping (not cross-tenant) and that these are configuration-sized in practice — except scoring versions and analytics.

### H-9 · LOW — Response data hygiene

| Item | Where | Note |
|---|---|---|
| `storageKey` + `checksum` leaked | `GET /imports/:id` returns full row (`imports.service.ts:204-210`) while the list view deliberately excludes them (`:19-33`) | Storage key reveals internal bucket/dir layout |
| Refresh token in JSON body | register/login/refresh (`auth.controller.ts:16-21,153-160`) **in addition to** httpOnly cookie | Cookie alone is the safer pattern; body copy widens XSS exposure |
| Raw driver/Redis error strings | `GET /health` (`health.controller.ts:33,39`) | Version/connection details to unauthenticated callers |
| Unsanitized lead payloads | `GET /leads/:id/payloads` (`leads.service.ts:155-166`) — webhook *events* are sanitized, raw payloads are not | Inherits whatever the client sent; tenant-only access, so accepted risk — document |
| 429 message passthrough | `all-exceptions.filter.ts:71-89` forwards `HttpException.message` verbatim | Controlled vocabulary today; keep messages free of internals |

Verified safe ✅: password hashes excluded by select (`users.service.ts:9-17`), API key hash never returned (`api-keys.service.ts:8-19`), raw key **once** at create, destination credentials `stored:true` only, webhook secrets once/rotate-only, audit metadata secret-stripped (`shared/sanitize.ts`), no stack traces in any response (filter logs only, `all-exceptions.filter.ts:33-40`).

### H-10 · LOW — Health endpoint semantics

`GET /api/v1/health` returns **HTTP 200** with `status:"degraded"` when PG/Redis fail (`health.controller.ts:41-47`) and includes raw error strings. It checks PG + Redis but **not the worker/BullMQ consumer** (no worker heartbeat anywhere; worker has no HTTP server). Orchestrators keyed on status codes would keep routing traffic to a broken instance.

---

## Verification matrix (per §10 checklist)

| Check | Result |
|---|---|
| **Authentication** | Dual: `Authorization: Bearer` (JWT, signature+issuer, DB-reloaded user, ACTIVE status, tenant match `:88-94`) or `x-api-key` (SHA-256 lookup, status/revoked/expiry/tenant `:112-123`). 6 `@Public` routes: register/login/refresh/logout, webhook ingress, health — all still throttled. Gap: H-3 session revocation, H-4 key-vs-user. |
| **Authorization** | 73/78 non-public routes have `@RequirePermission`; the 2 permission-free authenticated routes (`GET /auth/me`, `GET /tenants/me`) are self-scoped by design; `POST /auth/logout` needs only possession of a refresh token (acceptable). Permissions resolved **per-request from DB role** (`jwt-auth.guard.ts:84-87,103`) — no stale JWT claims. Gap: H-2 wildcard keys. |
| **Tenant isolation** | `tenantId` is **never client-controlled** (grep: no body/query/header tenant anywhere; DTOs contain no tenant field; `CurrentUser` reads only `request.actor`). All list queries filter `tenantId`; all cross-tenant id lookups return **404** (anti-enumeration). Write paths use check-then-act (read scoped row → mutate by id) — **partial** TOCTOU pattern in 17 services (no `$transaction`; the provided `assertSameTenant` helper in `packages/database/src/tenant.ts:16` is unused, grep=0). No confirmed cross-tenant *write*; the confirmed cross-tenant *read* is H-1. |
| **Input validation** | Zod DTOs via `createZodDto` + `ZodValidationPipe` (`main.ts:59`) on all typed routes; body limit 1 MB; upload cap 50 MB. **Untyped:** `/webhooks/events` query (inline TS), `/deliveries/failed|dead-letter` query (raw strings, manual `Number()`), webhook ingress body (`unknown` — required for HMAC), inline `daysQuery` (validated in-handler). |
| **Rate limiting** | Global 300/min/IP; auth register/login/refresh 20/min; webhook ingress 600/min; no skips. 429 → `RATE_LIMITED`. Note: `/auth/logout` falls under global limit (fine). Health unauthenticated under 300/min (probe-friendly). |
| **Sensitive data** | See H-9. At rest: bcrypt cost 12, SHA-256 key hashes, AES-256-GCM credentials (`v1.<iv>.<tag>.<ct>`, `shared/crypto.ts:41-54`), refresh rotation with reuse detection. |
| **Audit logging** | See H-7. Fail-open by design (never breaks the request), append-only tables (no `updated_at` on AuditLog/LeadStageEvent/DeliveryAttempt — tested). |
| **IDOR / cross-tenant** | No bare-id IDOR found beyond H-1's non-id variant; every `:id` route is tenant-checked (evidence table per service in the working notes; spot-checked all 17 modules). |
| **Privilege escalation** | Roles can only grant catalog codes (34); system roles immutable; self-DISABLE refused; wildcard reachable only via H-2. No endpoint accepts `role`/`permissions`/`tenantId` for the actor themselves outside `users:write` (which is itself permissioned). |
| **Credential exposure** | None in responses except one-time reveals (API key, webhook secret) — by design. |

---

## Explicitly tested behaviors that back these claims (existing test suite)

- Tenant isolation semantics: `tests/integration/tenant-isolation.test.ts` (service-level, 404 semantics, raw-query scoping).
- DB idempotency uniques (webhook events, leads, deliveries, attempts): `tests/integration/idempotency.test.ts`.
- Replay immutability/attempt numbering: `tests/integration/replay.test.ts`.
- Signed-webhook e2e + duplicate collapse + bad-signature rejection: `tests/queue/pipeline-e2e.test.ts`.
- **Not tested at HTTP level:** guards, permission denials, rate limits, error envelopes — no supertest/controller tests exist (inventory Appendix 2).

---

## Recommended remediation order (approval required before any change)

1. **H-1** — scope queue endpoints (blocking for any multi-tenant exposure).
2. **H-2** — forbid implicit wildcard API keys; audit existing keys in DB.
3. **H-4** — tie key auth to user status (one-line join).
4. **H-6** — `requireSignature` default + webhook status-code decision.
5. **H-3** — session check on JWT path (or documented 15-min revocation window).
6. **H-8/H-9/H-10** — bounds, storageKey/refresh-token hygiene, health 503 semantics.
7. **H-5/H-7** — POST /leads idempotency; audit gaps.

No findings required schema changes except optionally an idempotency table for H-5 and (already-planned) password-reset tokens.
