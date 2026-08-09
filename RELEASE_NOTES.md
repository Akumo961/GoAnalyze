# Release Notes

## Version 2.0.0 — Government Release Candidate (RC-1)

This engagement extended the original 2.0.0 baseline (FastAPI platform API, Next.js console, domain models, ABAC, hash-chained audit, RAG, environmental review engine, case assignment, Docker/Helm/Terraform/Prometheus scaffolding) with the work summarized below. Every item is marked as either **verified** (executed and confirmed working), **executed against real infrastructure** (not mocked/simulated), or **not executable in this sandbox** (explicitly not claimed as done).

### Added

- **Document search** (`GET /v1/documents/search`) — OpenSearch REST integration with automatic database fallback, tenant-isolated, paginated, filterable. *Verified*: OpenSearch request/response shape unit-tested; fallback path exercised end-to-end (no live OpenSearch cluster in this sandbox — see Limitations).
- **Document upload/download** (`PUT`/`GET /v1/documents/{id}/content`, `/download`) — MinIO SDK integration with automatic in-memory fallback, SHA-256 integrity verification, streaming download, audit-logged. *Verified*: full round-trip tested including tampered-bytes rejection, cross-tenant rejection, oversized-upload rejection, adversarial/Unicode filename handling. MinIO's primary (non-fallback) path not executed against a live bucket — see Limitations.
- **Rate limiting** (per-IP/user/tenant, Redis-backed) — fails open if Redis is unreachable. *Executed against real infrastructure*: tested against a genuinely running `redis-server` (not just `fakeredis`), including real 429 responses with `Retry-After` headers.
- **Audit log pagination** (`GET /v1/audit`) — was previously unbounded; now `page`/`page_size`, matching the search endpoint's existing pattern. *Verified with a real benchmark*: 175ms/5000-row unbounded fetch reduced to 7.6ms/20-row paginated fetch (~23x) against real PostgreSQL.

### Fixed

- **Critical: audit hash-chain forking under concurrent writes.** The audit log's tamper-evidence chain could fork when two requests wrote audit events for the same tenant at close to the same time — a normal production scenario, not an edge case. Reproduced and quantified against real PostgreSQL (up to 91% of events forked at 300 concurrent writers). Root-caused, and fixed with a dedicated `audit_chain_state` table using standard `SELECT ... FOR UPDATE` row locking. *Verified*: zero forks at 10/50/100/300/500 concurrent writers against real PostgreSQL, with a documented, honest account of a first fix attempt (a PostgreSQL advisory lock) that did not work and was abandoned rather than shipped. See `ROOT_CAUSE_ANALYSIS.md` and `FINAL_DATABASE_AUDIT.md`.
- **Historical authentication bypass** — a forgeable string-based bearer token and an unauthenticated header-spoofing fallback were both closed; replaced with real Keycloak JWKS-based JWT verification (signature, issuer, audience, expiration).
- **Missing OpenTelemetry instrumentation** — `opentelemetry-*` packages were declared as dependencies but never actually used. Now genuinely wired (FastAPI + httpx + SQLAlchemy spans), with two real bugs found and fixed in the process: lost spans on shutdown (no flush), and a pytest/console-exporter background-thread race.
- **Database connection pool** — was silently capped at SQLAlchemy's own default (15 total connections), unconfigurable without a code change. Now exposed via `GOV_DATABASE_POOL_SIZE`/`MAX_OVERFLOW`/`POOL_TIMEOUT_SECONDS`.
- Two `mypy` type errors, one `ruff`-flagged style issue, and confirmed-dead code (an unused low-level repository method) — all found and removed.

### Infrastructure — executed against real infrastructure (not mocked)

- **PostgreSQL 16.14** — installed and run for the full duration of the later half of this engagement; used for concurrency testing, index verification (`EXPLAIN ANALYZE`), and a full `pg_dump`/`pg_restore` backup-and-restore cycle (verified: data survived intact after a full drop-and-restore).
- **Redis** — installed and run; used for rate-limit testing and chaos testing (killed and restarted mid-traffic; app recovered automatically).
- **Keycloak 26.0.7** — downloaded and run; a real realm, client, and 4 users were provisioned via the Admin REST API. A genuine Keycloak realm-provisioning bug was found and root-caused (see `ROOT_CAUSE_ANALYSIS.md`): realms created via the bare Admin API don't provision a working User Profile, silently blocking every password-grant login. Fixed by explicitly configuring the User Profile as part of realm setup.
- **Chaos testing** — Postgres and Redis were killed and restarted while the app was serving live traffic; confirmed `/health` (liveness) correctly stays up while `/ready` (readiness) correctly reports the outage and both recover automatically without an app restart.

### Not executed — explicitly not claimed as done

- **Docker / Docker Compose** — no Docker daemon is available in this sandbox. `docker-compose.production.yml`, `Dockerfile.production`, and `nginx/nginx.conf` were all authored and individually validated with the closest available real tooling (real `nginx -t`, a real multi-worker `uvicorn` boot, real YAML parsing) — but the full stack has never been brought up together.
- **OpenSearch and MinIO** (live instances) — no binary reachable from this sandbox (confirmed via failed download attempts against the sandbox's network allowlist, not assumed). Both integrations are real and have verified automatic fallback behavior, but their primary code paths have never run against live infrastructure.
- **GitHub Actions** — `.github/workflows/ci.yml` is YAML-valid and every individual step it runs (pytest/ruff/mypy/npm build+lint) was independently verified to pass in this sandbox, but the workflow has never executed on GitHub's own infrastructure.
- **TLS** — the Nginx config was validated against a locally-generated self-signed test certificate only; no real CA-issued certificate has been used.
- **Image vulnerability scanning** — a real `trivy` binary was downloaded and runs, but its vulnerability database is hosted outside this sandbox's network allowlist (confirmed via a direct 403). `pip-audit` and `npm audit` were run instead (both clean, except one documented, low-risk, unreachable-code-path `ecdsa` finding via `python-jose`).
- **Penetration testing** — no human security review has been performed.

### Security improvements

Real JWKS-based JWT verification closing the historical forgeable-token vulnerability; ABAC enforced on every route; security headers (CSP, X-Frame-Options, conditional HSTS); no hardcoded secrets, with production boot failing fast on unsafe configuration; server-derived (never client-supplied) storage keys closing a path-traversal surface; capped upload size and safely-encoded `Content-Disposition` filenames (CRLF-injection and Unicode both tested); `bandit`/`vulture`/`pip-audit`/`npm audit` all run and clean or documented.

### Testing completed

62 automated tests (`pytest`), all passing: authentication, tenant isolation, search, upload/download, rate limiting, audit pagination, ingestion pipeline, environmental engine, ABAC. `ruff`, `mypy`, `bandit`, `vulture` all clean. `npm run lint`/`npm run build` clean. This is in addition to the extensive manual real-infrastructure testing described above, which the automated suite's SQLite/fakeredis-based fixtures cannot exercise on their own.

### Breaking changes

- `GET /v1/audit` response shape changed from a bare list to `{"total", "page", "page_size", "total_pages", "items"}` — any existing client parsing this endpoint as a plain array will need to update.

### Known limitations

See `PROJECT_INVENTORY.md` and `HANDOFF.md` for the full list. In summary: no `statement_timeout`/deadlock stress testing, no point-in-time recovery, no structured/JSON logging, no Grafana dashboards, no frontend document-management UI.

### Recommended deployment process

1. Run `docker compose -f docker-compose.production.yml build && up` against a real Docker host first — this is genuinely untested territory.
2. Point `GOV_DATABASE_URL` at production PostgreSQL and run `alembic upgrade head`.
3. Provision the Keycloak realm using the explicit User Profile configuration documented in `ROOT_CAUSE_ANALYSIS.md`.
4. Point at real OpenSearch/MinIO and verify their primary (non-fallback) code paths.
5. Obtain a real TLS certificate for the Nginx config.
6. Run image vulnerability scanning from an environment with network access to a scanner's database.

---

## Version 2.0.0 (original baseline)

### Added

- Government-grade FastAPI platform API.
- Next.js TypeScript ministry operator console.
- Tenant, classification, citation, audit, and environmental review domain models.
- ABAC authorization checks with purpose-of-use control.
- Hash-chained audit event service.
- Evidence-grounded RAG response service.
- Environmental authorization review engine with admissibility, regulation mapping, compliance findings, missing-document detection, risk scoring, recommendations, justifications, and evidence tracing.
- Case assignment engine with SLA and escalation timestamps.
- Docker, Docker Compose, Kubernetes Helm chart, Terraform, and Prometheus configuration.
- Procurement, business case, cost-benefit, competitive analysis, readiness, and delivery documentation.

### Changed

- Removed the legacy companion-application architecture; the platform is now fully standalone with no external document-management dependency.

### Security

- Added zero-trust target architecture, tenant isolation model, RBAC/ABAC controls, audit model, and Keycloak deployment target.
