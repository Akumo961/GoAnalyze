# FINAL_VALIDATION_REPORT.md

**Date:** 2026-08-02
**Role:** QA / DevOps / Security validation pass, executed hands-on
**Sandbox constraints (apply to every phase below):** no Docker daemon
(`docker: command not found`), and container-registry domains are blocked
by the egress proxy (`registry-1.docker.io` -> `403`). This makes Phases 1,
3 (MinIO/OpenSearch), and 4 (a real Keycloak server) impossible to run
against real infrastructure here. Everywhere else, this report reflects
commands actually executed, with real output — not projected results.

---

## PHASE 1 — DOCKER VALIDATION: ✖ BLOCKED (infrastructure unavailable)

`docker compose build --no-cache` / `docker compose up -d` could not be
run. Evidence of the blocker:
```
$ which docker
(not found)
$ curl -o /dev/null -w "%{http_code}" https://registry-1.docker.io
403
```
**What was validated instead:**
- `docker-compose.yml` parses as valid YAML and every previously-hardcoded
  secret now requires an environment variable with no insecure fallback.
- `Dockerfile`'s core step, `pip install .`, was proven to work (same
  command run directly in this session, see Phase 2).
- Every service the app depends on at the code level (Postgres via
  asyncpg/SQLAlchemy, Keycloak via JWKS/JWT) was validated against
  lightweight real stand-ins (SQLite, a locally-hosted real HTTP JWKS
  endpoint) — see Phases 2 and 4.

**Action required before production sign-off:** run
`docker compose build --no-cache && docker compose up -d` in an environment
with Docker, and confirm all containers reach a healthy state.

---

## PHASE 2 — DATABASE VALIDATION: ✔ PASSED (via SQLite stand-in)

Real PostgreSQL was unavailable, so this was validated against SQLite —
the same SQLAlchemy async engine/model code path, different connection
string. Executed as one continuous process lifecycle (not mocked):

1. `alembic upgrade head` — creates `documents`, `users`, `case_assignments`,
   `audit_events`, `alembic_version` tables. **Passed.**
2. Started the API (RUN 1), ingested a real document via a **real signed
   JWT verified over a real HTTP round-trip** to a locally-hosted JWKS
   server (not an in-process mock) — `POST /v1/documents` -> `200`.
3. **Killed the server process entirely** (`SIGTERM`, full process exit).
4. Started a fresh API process (RUN 2) against the *same* SQLite file.
5. `POST /v1/documents/{id}/process` for the document created in RUN 1 —
   **succeeded (200)**, proving the row survived the restart.
6. `GET /v1/audit` after restart returned **2 persisted audit events**
   (`document.ingested`, `document.pipeline_completed`), proving the
   hash-chained audit log also survives restarts.

```
RUN1 healthy: True
ingest status: 200 body: {'tenant_id': 'ministry-a', ..., 'id': 'a0de5aa3-...'}
--- server shut down ---
RUN2 healthy: True
process-after-restart status: 200
completed: True
audit status: 200 event count: 2
```

`alembic downgrade base` was also run and cleanly dropped all four tables.

**Verdict:** repository layer, schema, and persistence are correct.
**Caveat:** connection pooling, concurrent-write behavior, and
Postgres-specific features (if any are added later) still need validation
against real Postgres.

---

## PHASE 3 — STORAGE VALIDATION: ✖ PARTIALLY BLOCKED

MinIO and OpenSearch are not reachable in this sandbox (same Docker
constraint as Phase 1), so:
- ✖ Files stored in MinIO — not tested (no MinIO instance).
- ✔ Metadata stored in PostgreSQL(-compatible) — proven in Phase 2;
  `object_uri`, `sha256`, `filename`, `content_type`, `classification` all
  persist correctly per document row.
- ✖ Search index — **there is no search index or search endpoint in the
  codebase today.** `/v1/rag/answer` takes citations the *caller* supplies;
  it does not perform server-side retrieval against OpenSearch or any
  other index. This is a pre-existing architectural gap, not something
  broken by this session's changes — flagging it because Phase 3/6/7 of
  this request assume a search feature that doesn't exist yet.
- ✖ Document retrieval — there is no `GET /v1/documents/{id}` endpoint
  either; documents can only be fetched implicitly via `/process` (which
  returns a processing result, not the stored file). Retrieving the actual
  file bytes would require a MinIO-backed download endpoint that also
  doesn't exist yet.

**Action required:** these are real product gaps, separate from the
security/persistence work done in prior sessions. Recommend scoping a
follow-up engagement specifically for object storage retrieval and search,
since fixing them meaningfully requires live MinIO/OpenSearch to test
against.

---

## PHASE 4 — AUTHENTICATION: ✔ PASSED (against a real, locally-hosted JWKS server)

No real Keycloak was available, but rather than mocking JWT verification
in-process, a minimal real HTTP server was stood up to serve a genuine
JWKS document, and the running API fetched it over actual network I/O —
exercising the real production code path (`httpx` GET, `PyJWT`
signature/issuer/audience/expiry checks), not a stub.

| Case | Expected | Actual |
|---|---|---|
| Valid signed JWT | success | `200` |
| Malformed / non-JWT string (incl. the historical `tenant:x:role` exploit) | 401 | `401 {"detail":"malformed_token"}` |
| Expired JWT | 401 | `401 {"detail":"token_expired"}` |
| Wrong audience | 401 | `401 {"detail":"invalid_claims:Invalid audience"}` |
| Wrong issuer | 401 | `401 {"detail":"invalid_claims:Invalid issuer"}` |
| Valid claims, forged signature (different keypair) | 401 | `401 {"detail":"invalid_signature"}` |
| Valid token, wrong tenant on resource | 403 | `403 {"detail":"tenant_mismatch"}` |

**Note on "Configure Keycloak / create Admin, Reviewer, Reader users":**
this requires a real running Keycloak instance with an admin console —
not achievable without Docker. What *is* proven is that the app correctly
enforces role claims (`roles` in the JWT) regardless of where they came
from — see the `case-manager` role-gating test in Phase 7.

---

## PHASE 5 — MULTI-TENANT TEST: ✔ PASSED

Two tenants (`ministry-a`, `ministry-b`) each with their own real signed
JWT, tested against the live server:

| Check | Result |
|---|---|
| Tenant A ingests own document | `200` |
| Tenant B ingests own document | `200` |
| Tenant B processes Tenant A's document | `403 tenant_mismatch` |
| Tenant A processes Tenant B's document | `403 tenant_mismatch` |
| Tenant B cites Tenant A's document in `/v1/rag/answer` | `403 citation_tenant_mismatch` |
| Tenant A cites own document in `/v1/rag/answer` | `200`, grounded answer returned |
| `GET /v1/audit` as Tenant A | only Tenant A's 2 events |
| `GET /v1/audit` as Tenant B | only Tenant B's 1 event, Tenant A's document ID absent from response |

**Downloads:** not testable — no download endpoint exists (see Phase 3).
**Search:** not testable — no search endpoint exists (see Phase 3).

---

## PHASE 6 — FRONTEND: ✔ PASSED

```
$ npm run build
✓ Compiled successfully
Route (app): /, /_not-found, /setup
$ npm run lint
(zero findings)
```

Started the production server (`npm run start`) and fetched both routes
over real HTTP (no browser automation tooling is available in this
sandbox, so this validates server-rendered output, not client-side
interactivity/JS execution):

```
GET / -> 200, 14688 bytes
GET /setup -> 200, 6222 bytes
```

**Setup wizard completion + redirect:** code-level verified — the wizard
now redirects to `/` (the existing dashboard route) instead of the
previously broken `/dashboard`. `POST /v1/setup` was exercised directly
via the API (see Phase 7) and returns `{"accepted": true, ...}` for a
complete, valid configuration.

**Not tested:** actual browser-driven clicking through the wizard, file
upload UI, or search UI — no Playwright/browser automation tool is
available in this sandbox, and (per Phase 3) there is no working
upload/search backend to click through to yet regardless.

---

## PHASE 7 — API TESTING: ✔ PASSED (9/9 routes exercised)

`GET /openapi.json` was fetched and saved to `openapi_export.json` in the
repo root — valid OpenAPI 3.1.0, parses cleanly, 9 paths documented,
matching the actual route table:
`/health`, `/metrics`, `/v1/documents`, `/v1/setup`,
`/v1/documents/{document_id}/process`, `/v1/rag/answer`,
`/v1/environmental-reviews`, `/v1/cases/{case_id}/assign`, `/v1/audit`.

Every route was hit with real requests:

| Endpoint | Result |
|---|---|
| `GET /health` | `200` |
| `GET /metrics` | `200` (Prometheus text format) |
| `POST /v1/setup` (full valid payload) | `200 {"accepted": true, ...}` |
| `POST /v1/documents` | `200` (valid), `401`/`403` (invalid auth/tenant, see Phase 4/5) |
| `POST /v1/documents/{id}/process` | `200` (own tenant), `403` (cross-tenant) |
| `POST /v1/rag/answer` | `200` (own tenant citation), `403` (cross-tenant citation), `401` (unauthenticated) |
| `POST /v1/cases/{id}/assign` | `200` with `case-manager` role, `403` without |
| `GET /v1/audit` | `200`, tenant-scoped |

**27/27 automated checks passed** in this session's full validation run
(auth edge cases + multi-tenant + API sweep + security probes combined).

---

## PHASE 8 — SECURITY AUDIT (OWASP-style)

| Category | Finding | Status |
|---|---|---|
| SQL Injection | All queries go through SQLAlchemy's parameterized ORM layer; tested a `filename` containing `'; DROP TABLE documents; --` — stored as inert literal text, table intact afterward. | ✔ Not exploitable |
| XSS | Frontend is React (auto-escapes rendered text); backend returns JSON only, no HTML templating. | ✔ Low risk |
| CSRF | API is stateless bearer-token auth (no cookies/sessions) — CSRF requires an ambient credential like a cookie, which doesn't exist here. | ✔ Not applicable in current design |
| SSRF | No user-supplied URL is fetched server-side. `object_uri` is stored as metadata only; the JWKS URL is server-configured, not user-controlled. | ✔ Not exploitable currently |
| JWT | Full signature/issuer/audience/expiry verification via JWKS; old forgeable-token vulnerability closed and regression-tested. | ✔ Fixed, tested |
| Secrets | No hardcoded secrets remain; `docker-compose.yml` requires env vars with no fallback; app refuses to boot in production with an unsafe audit secret or the dev-auth bypass enabled. | ✔ Fixed |
| Authentication | Real JWKS-based verification, tested against 6 attack shapes (malformed, expired, wrong aud, wrong iss, forged sig, legacy exploit string) — all correctly rejected. | ✔ Fixed, tested |
| Authorization (ABAC) | Role + classification + purpose checks enforced per-request. | ✔ Tested |
| Tenant isolation | Verified across ingestion, processing, RAG citations, and audit log. | ✔ Tested |
| Rate limiting | **None implemented.** No throttling on any endpoint. | ✖ Gap — recommend adding before production (e.g. `slowapi` or a gateway-level limiter) |
| CORS | `allow_origins` is an explicit configured list (not `*`); tested a cross-origin preflight from an untrusted origin — response does not reflect it. | ✔ Correctly scoped |
| Security headers | **Gap found and fixed this session:** the API previously sent no `X-Content-Type-Options`, `X-Frame-Options`, or `Content-Security-Policy` headers. Added a middleware; HSTS is added automatically outside `development`. Verified via live request. | ✔ Fixed, tested |

**Net new fix this session:** security-headers middleware in `gov_platform/main.py`.

**Remaining gap:** rate limiting. Not fixed this session — flagged as a
recommended follow-up rather than silently left off the list.

---

## PHASE 9 — PERFORMANCE

**Caveat, read first:** this measures a **single uvicorn worker on SQLite
inside a shared, resource-constrained sandbox container** — not
PostgreSQL with connection pooling, not multiple workers, not real
hardware. These numbers are useful for *relative* bottleneck-spotting
only, not as production capacity planning figures.

Concurrent `POST /v1/documents` requests via `httpx.AsyncClient` +
`asyncio.gather`:

| Concurrency | Success rate | Throughput | p50 latency | p95 latency | Max latency |
|---|---|---|---|---|---|
| 100 | 100/100 | 46.3 req/s | 819 ms | 1,749 ms | 2,154 ms |
| 500 | 500/500 | 45.0 req/s | 6,834 ms | 9,065 ms | 10,601 ms |
| 1000 | 1000/1000 | 30.7 req/s | 21,681 ms | 24,254 ms | 26,908 ms |

Server RSS after the 1000-request run: ~105 MB (single process).

**Zero failures at every concurrency level** — the app degrades gracefully
(queues and slows down) rather than error out or crash, which is the
correct failure mode. **Bottleneck identified:** throughput is flat
(~30–46 req/s) regardless of concurrency, and latency grows roughly
linearly with load — a classic single-worker/single-writer serialization
signature, consistent with (a) one uvicorn worker process, and (b) SQLite
allowing only one writer at a time (each request does a read-then-write
for the audit hash chain, which is inherently sequential per tenant even
on Postgres, though Postgres's MVCC and multiple workers would parallelize
the surrounding I/O much better).

**Recommended optimizations before production load testing:**
1. Run multiple uvicorn/gunicorn worker processes (`--workers N`) — trivial
   win, this sandbox test used exactly one.
2. Re-run this same test against real PostgreSQL, which allows genuine
   concurrent connections unlike SQLite's single-writer model.
3. If the audit hash-chain read-then-write proves to be a bottleneck even
   on Postgres under real load, consider a per-tenant advisory lock or a
   dedicated append-only sequence rather than a full row scan for
   "latest event," to reduce lock contention.
4. This test only exercised one write-heavy endpoint; read-heavy endpoints
   (`/v1/audit`, `/health`) were not load-tested here and are likely to
   scale much better.

**Not done:** true 100/500/1000 *concurrent user* browser sessions (this
was concurrent HTTP requests, not simulated user sessions with think-time),
and no CPU/memory profiling tool beyond reading `/proc/<pid>/status` RSS
was available in this sandbox.

---

## PHASE 10 — DEPLOYMENT CHECKLIST

- [x] Application code installs cleanly (`pip install -e .`)
- [x] Database schema + migrations exist and run correctly (verified on SQLite; needs re-verification on real Postgres)
- [x] Authentication is cryptographically real (JWKS/JWT), not forgeable
- [x] Tenant isolation enforced and tested across all data-access paths
- [x] Audit trail is persisted and tamper-evident
- [x] Secrets are environment-provided; production boot fails on unsafe config
- [x] Security headers present
- [x] Frontend builds and lints cleanly
- [x] OpenAPI schema exports and validates
- [ ] **Full Docker Compose stack has never been run** — top blocker
- [ ] **No real Keycloak realm/users configured or tested against**
- [ ] **No MinIO/OpenSearch-backed file storage, retrieval, or search exists**
- [ ] Rate limiting not implemented
- [ ] No load test against real Postgres / multi-worker deployment
- [ ] No penetration test, DR/backup exercise, or CI pipeline found in-repo

## Overall readiness score: 60 / 100

Down slightly from the prior session's 62 after this deeper pass surfaced
two additional concrete gaps (no rate limiting was already known; the
absence of *any* search or document-download endpoint became clear only
once this session tried to exercise Phase 3/6 end-to-end and found there
was nothing there to test). The security-headers gap found this session
was fixed and re-verified. The score reflects: strong, tested
application-layer correctness and security, against infrastructure and
product-surface gaps (search, downloads, real Docker stack, real Keycloak)
that require capabilities this sandbox does not have to close out.
