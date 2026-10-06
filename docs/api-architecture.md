# API Architecture — Lead Integration & Distribution Middleware

**Audit date:** 2026-10-01 · Describes the system **as built** (verified against code) and the recommended target state. No changes were made.

---

## 1. System shape

```
                      ┌────────────────────────────────────────────────┐
 Browser (Next.js 16) │  apps/web  — client-only React, no server calls │
  69 API calls ───────┼─► src/lib/api.ts  (fetch wrapper, envelope unwrap│
                      │   single-flight 401→refresh→retry, unauth hook) │
                      │   React Query hooks: src/lib/queries/*.ts       │
                      └───────────────┬────────────────────────────────┘
                                      │ HTTPS  Bearer JWT | x-api-key
                      ┌───────────────▼────────────────────────────────┐
                      │  apps/api — NestJS 11, 17 controllers/81 routes │
                      │  main.ts: prefix "api" + URI version "1"        │
                      │  guards: Throttler → JwtAuthGuard → Permissions  │
                      │  pipes: ZodValidationPipe (createZodDto)        │
                      │  interceptors: Correlation → ResponseTransform   │
                      │  filter: AllExceptionsFilter (no stack traces)   │
                      └──┬──────────────────────────┬───────────────────┘
                         │ Prisma (tenant-scoped)   │ BullMQ enqueue
                         ▼                          ▼
              ┌──────────────────┐       ┌─────────────────────────────┐
              │ PostgreSQL       │       │ Redis/Memurai               │
              │ 29 models,       │◄──────┤ 8 queues + `-dlq` siblings  │
              │ tenantId on 27/29│       │ custom backoff w/ Retry-After│
              └──────────────────┘       └──────────────┬──────────────┘
                                                        ▼
                      ┌────────────────────────────────────────────────┐
                      │  apps/worker — BullMQ consumers (no HTTP)       │
                      │  intake → pipeline stages → delivery attempt    │
                      │  csv-import, retry sweeper, DLQ writer          │
                      │  egress ONLY via packages/integrations adapters │
                      │  (SSRF-safe safeFetch: DNS-rebinding aware)     │
                      └────────────────────────────────────────────────┘
```

Key facts:

- **Single HTTP surface.** One Nest app; no microservices, gateways, SSE, or worker HTTP (`apps/worker` makes zero HTTP calls of its own — all egress through adapters).
- **No Next.js server-side proxy.** No `route.ts` handlers, no server actions, no rewrites (`next.config.ts` is 7 lines). The browser talks to the API directly with `NEXT_PUBLIC_API_URL`.
- **Zod all the way down.** `packages/validation` (34 schemas) is the single source of request truth; controllers wrap schemas with `nestjs-zod`'s `createZodDto`. Shared enums/contracts in `packages/types` mirror Prisma enums 1:1.

---

## 2. Request lifecycle (contract)

1. **Correlation** — `x-correlation-id` accepted (validated `^[A-Za-z0-9._:-]{8,128}$`) or generated; echoed on the response (`request-context.middleware.ts`).
2. **Rate limit** — ThrottlerGuard first (applies even to `@Public` routes).
3. **Authenticate** — `JwtAuthGuard`: `x-api-key` wins if present (SHA-256 lookup) else Bearer JWT; every request reloads the principal from DB (user status, tenant status, role permissions fresh — no stale claims). Sets ambient ALS actor `{userId, tenantId, permissions…}`.
4. **Authorize** — `PermissionsGuard` reads `@RequirePermission(...)` metadata; `"*"` matches all (currently reachable only via empty-scope API keys — security H-2).
5. **Validate** — `ZodValidationPipe` on body/query/params DTOs → 400 `BAD_REQUEST` + `details[]` on failure (service-thrown `ZodError` → 422 `VALIDATION_FAILED`).
6. **Handle** — controller → service. Services take `actor` first; every read filters `tenantId`; writes follow check-then-act on a tenant-scoped row.
7. **Audit** — mutations call `audit.record` (~40 sites; secret-stripped; fail-open).
8. **Respond** — `ResponseTransformInterceptor` wraps `{success:true,data}` (`@SkipTransform` for CSV download); errors → `{success:false,error:{code,message,requestId,details?}}`.

**Status codes in use:** POST→201 (no `@HttpCode` anywhere), everything else→200; 400/401/403/404/409/422/429/500/503 from the shared `ERROR_CODES` map (`packages/types/src/errors.ts`). Health returns 200-even-when-degraded (finding H-10).

---

## 3. Authentication model

| Aspect        | Implementation                                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token  | JWT HS256,`JWT_ACCESS_TTL` 900 s, issuer `lead-middleware`; **not** stateful — validated by signature + DB principal reload                          |
| Refresh token | SHA-256-hashed in`UserSession`, httpOnly cookie scoped `/api/v1/auth` (+ returned in body — H-9), **rotating**; reuse detection revokes all sessions |
| API keys      | `x-api-key`, SHA-256 `keyHash` unique; status/revoked/expiry checked; `lastUsedAt` fire-and-forget                                                        |
| Permissions   | 34-code catalog (`packages/types/src/permissions.ts`); role-permissions re-read per request; 4 seeded system roles                                            |
| Webhooks      | Unauthenticated by token: identified by unguessable `publicId`; rate-limited, normalized and idempotently queued without caller signatures |
| Known gaps    | H-3 revocation window, H-4 disabled-user keys, H-2 wildcard scopes (see security doc)                                                                           |

**Tenant derivation:** credential → `actor.tenantId` exclusively. Webhook: `publicId → LeadSourceAccount.tenantId`. Nothing accepts tenantId from request input.

---

## 4. Data & idempotency model

| Concern                     | Mechanism                                                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant scoping              | `tenantId` on 27/29 models (exceptions: `Tenant`, `UserSession` global; `AuditLog.tenantId` nullable-by-design for SYSTEM/WORKER actors)                        |
| Inbound webhook idempotency | `@@unique([tenantId, sourceAccountId, idempotencyKey])`; key = external event id or body hash; duplicate → resume/ack                                                |
| Manual lead idempotency     | `@@unique([tenantId, sourceAccountId, externalLeadId])` — **optional field ⇒ gaps when omitted (H-5)**                                                        |
| Delivery identity           | `@@unique([tenantId, leadId, destinationId])`; attempts `@@unique([tenantId, deliveryId, attemptNumber])` — append-only, never rewritten                           |
| Replay semantics            | Global attempt counter; each replay opens a cycle (`replayCycle`, `cycleStartAttempt`, `maxAttempts += 5`); cycle-local backoff; P2002 treated as invariant guard |
| Outbound idempotency        | Worker sends `Idempotency-Key: tenantId                                                                                                                                 |
| Immutable history           | `DeliveryAttempt`, `LeadStageEvent`, `LeadScore`, `LeadRawPayload`, `AuditLog` — no `updated_at` columns (tested)                                          |
| Secrets at rest             | bcrypt(12), SHA-256 hashes, AES-256-GCM`v1.<iv>.<tag>.<ct>`                                                                                                           |

---

## 5. Queue topology (BullMQ)

| Queue                                      | Producer(s)                                                                  | Consumer                                                           | DLQ                                                |
| ------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------- |
| `lead-intake`                            | API (webhook fast-ack, manual POST /leads), worker (CSV)                     | `intake.processor` → chains lead-processing                     | `lead-intake-dlq`                                |
| `lead-processing`                        | intake processor, API lead replay                                            | `pipeline.processor` (stage chain)                               | `lead-processing-dlq`                            |
| `enrichment` / `scoring` / `routing` | **none (stage queues currently dead — processed inline by pipeline)** | registered processors                                              | `*-dlq`                                          |
| `delivery`                               | pipeline`enqueueDelivery`, replay sweeper                                  | `delivery.service.attempt()` (concurrency 10)                    | `delivery-dlq` (terminal `UnrecoverableError`) |
| `retry`                                  | API`POST /deliveries/:id/replay` + repeatable `sweep-deliveries`         | `replay.processor` / sweeper                                     | `retry-dlq`                                      |
| `csv-import`                             | API`POST /imports`                                                         | `csv-import.processor` (100k rows, deterministic externalLeadId) | `csv-import-dlq`                                 |

- Backoff: custom strategy, base 2 s, max 300 s, ±10 % jitter, honors destination `Retry-After` (`queues.ts:60-81`, `workers.service.ts:130-136`); DB-level caps enforce attempt ladders (2/4/8/16 s tested).
- DLQ: worker `failed` handler → `<queue>-dlq` with `originalJobId/failedReason/attempts`, retained forever (`removeOnComplete/Fail:false`).
- **Note:** dead `enrichment`/`scoring`/`routing` queues exist but nothing enqueues them (pipeline executes stages in-process). Either wire producers or retire them — flagged for architecture review, not an API issue.
- Queue admin APIs are intentionally **absent** (safety requirement).

---

## 6. Egress & adapters

- All outbound traffic (delivery + connection tests) goes through `packages/integrations` registry: `salesforce, zoho, hubspot, pipedrive, dct-crm, custom-api, webhook` — covers all 7 `DestinationType`s.
- `safeFetch` (`http.ts:107-143`): http/https only, no embedded credentials, literal private-IP block, **DNS `lookup(host,{all:true})` rejects if any resolved address is private** (rebinding-safe), hard timeout, sanitized ≤2 KB error bodies, `DESTINATION_SSRF_BLOCKED` code.
- Outbound webhook adapter signs with its own HMAC (`x-middleware-signature` + timestamp).
- Test hook: `POST /destinations/:id/test` exercises the same guarded path.

---

## 7. Frontend ↔ API mapping (coverage health)

- **69 distinct calls, 73 call sites — 100 % matched to real routes** (0 calls to missing endpoints, 0 wrong HTTP methods). All calls originate in `lib/api.ts` + `lib/queries/*`.
- List envelopes `{items,nextCursor,total}` are supersets of what the web reads; web uses `useInfiniteQuery` cursors consistently.
- Unconsumed-by-web (11): all 4 `/imports`, 2 `/webhooks/events`, `DELETE /leads/:id`, `GET /sources/:id`, `PATCH /sources/accounts/:accountId`, `GET /destinations/:id/health`, `POST /auth/register` (see inventory §E — all intentionally kept).
- Mismatches to fix (inventory §I): dead `useCreateLead` wrong body; `{queued}` vs `{replayed}` type; `retryAt` shows job creation time.

---

## 8. Testing posture

| Layer                              | Status                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| Unit (vitest)                      | 4 files — worker pipeline, conditions, CSV, queue jobId                        |
| Integration (real PG)              | 6 files — tenant isolation, DB idempotency, pipeline, replay, audit, db-safety |
| Queue/e2e (real Redis)             | queue mechanics + signed-webhook→delivery e2e                                  |
| **HTTP surface (supertest)** | **none — zero controller/guard/DTO tests**                               |
| Playwright                         | script exists, no config/tests                                                  |

Highest-leverage additions: auth flows (401/403 matrix), RBAC denial per permission family, cross-tenant 404 matrix over HTTP, rate-limit 429, webhook signature + 201/202 contract, `POST /leads` idempotency, upload validation.

---

## 9. Documentation & OpenAPI posture

- `@nestjs/swagger` v11 installed and `@ApiTags/@ApiOperation` present on **all 17 controllers** — but **no `SwaggerModule.createDocument` call exists**, so no UI/document is ever served; `@ApiProperty` unused (zod DTOs instead).
- Repo previously contained **no docs at all** (no README, no docs/, no openapi/postman artifacts).
- This audit created `docs/api-inventory.md`, `docs/api-gaps.md`, `docs/api-security-audit.md`, this file, and `docs/openapi.yaml` (hand-derived from code, marked `x-audit-status`).

---

## 10. Recommended architecture (J)

**Direction: fix and harden the current design — it is coherent, typed, tested at the data layer, and nearly complete. Do not re-platform.**

1. **Security first (blocking for multi-tenant exposure):** implement H-1 queue scoping, H-2 wildcard-key removal, H-4 key/user status coupling — all guard/service-level, zero schema changes.
2. **Finish the two half-built features:** `POST /auth/change-password` (schema exists), `POST /imports/:id/cancel` (enum+worker exist).
3. **Make OpenAPI a build artifact:** register `SwaggerModule` with `DocumentBuilder` in `main.ts` (dependency already present; decorators already present) so `docs/openapi.yaml` stops being hand-maintained. Keep `x-audit-status` separation (implemented/planned/missing) until then.
4. **Contract coherence pass:** webhook 202 vs 201 (pick one and align code+docs), health 503 on critical failure + worker heartbeat (smallest viable: worker writes a heartbeat row/Redis key health can read), `retryAt` real semantics (BullMQ `nextProcessedAt`), zod DTOs for the three untyped query surfaces.
5. **Bound every list:** add `take` to the 6 unbounded reads (or explicitly document as bounded reference data with hard caps); convert `analytics/destinations` to SQL `groupBy`.
6. **Idempotency story:** honor `Idempotency-Key` on `POST /leads` (or require `externalLeadId`); keep webhook/delivery model as-is.
7. **Sequenced feature gaps (from api-gaps.md):** REST completeness (users detail/delete, audit detail) → password reset (after mailer) → import preview / pipeline simulate (shared read-only evaluator for routing+scoring+dedup) → enrichment provider domain → OAuth credential vault → tenants-CRUD admin console. Each gated on an approved consumer.
8. **Test the HTTP surface** (supertest matrix above) before any external exposure; keep queue/admin routes unexposed.
9. **Naming cleanups only when touching those routes anyway:** nest `/sources/accounts/:accountId` under `/sources/:id/accounts/:accountId`, keep `/automation/*` grouping as the precedent for future feature groups.
10. **Retire or wire the three dead stage queues** (`enrichment`, `scoring`, `routing`) to match reality.

**Non-goals (confirmed absent on purpose):** queue administration APIs, duplicate-merge semantics, bulk lead mutation, unversioned routes, per-provider webhook handlers, tenantId in requests.

* **Username/Email:** `owner@demo.dev`
* **Password:** `Str0ngP@ssw0rd!2026`
