# HANDOFF.md

## Project name
GoAnalyze — Government AI Document Intelligence Platform

## Project version
2.0.0 (`pyproject.toml` / `frontend/package.json`)

## Architecture overview
- **Backend:** FastAPI (`gov_platform/`), async throughout, SQLAlchemy 2.0 + Alembic against PostgreSQL, Redis-backed rate limiting, real Keycloak JWKS-verified JWT authentication, OpenTelemetry tracing (FastAPI + httpx + SQLAlchemy spans), Prometheus metrics.
- **Frontend:** Next.js/TypeScript (`frontend/`) — enterprise configuration wizard (`/setup`) and a dashboard shell (`/`).
- **Data plane:** PostgreSQL (documents, users, case assignments, hash-chained audit events), Redis (rate limiting), OpenSearch (search, with automatic database fallback), MinIO (object storage, with automatic in-memory fallback).
- **Identity:** Keycloak (OIDC/JWKS), with Azure AD / Microsoft Entra ID federation support in the setup wizard.
- **Observability:** OpenTelemetry (real, verified — not a declared-but-unused dependency), Prometheus `/metrics`, `/health` (liveness) + `/ready` (readiness, real DB check).

## Implemented features
- Document ingestion pipeline: upload → OCR (stub) → classification → metadata/entity extraction → compliance analysis → risk scoring → vector indexing (search) → workflow routing → audit logging.
- Document search (`GET /v1/documents/search`) — OpenSearch-backed, tenant-isolated, paginated, filterable, with automatic database fallback.
- Document upload/download (`PUT`/`GET /v1/documents/{id}/content`, `/download`) — MinIO-backed, SHA-256 integrity verified, streaming, audit-logged, with automatic in-memory fallback.
- Evidence-grounded RAG (`POST /v1/rag/answer`) — citation-based, tenant-isolated (every cited document is re-verified server-side).
- Environmental/regulatory review engine (`POST /v1/environmental-reviews`).
- Case assignment workflow (`POST /v1/cases/{id}/assign`).
- Hash-chained, tenant-scoped audit trail (`GET /v1/audit`, paginated) — concurrency-safe via row-locked chain writes (see Known Limitations for the story behind this).
- Enterprise setup wizard (`POST /v1/setup`, frontend `/setup`).

## Security features
- Real JWKS-based JWT verification (signature, issuer, audience, expiration) — the historical forgeable-token vulnerability is closed and regression-tested.
- ABAC: tenant, role, classification, and purpose-of-use checks on every route.
- Redis-backed rate limiting: per-IP (pre-auth), per-user and per-tenant (post-auth, keyed off verified JWT claims), fails open if Redis is unreachable.
- Security headers (CSP, X-Frame-Options, X-Content-Type-Options, conditional HSTS).
- No hardcoded secrets; production boot fails fast on unsafe configuration (default audit secret, dev-auth bypass enabled, etc.).
- Storage keys always server-derived (never from client-supplied fields) — no path-traversal surface.
- Upload size capped (100 MB); `Content-Disposition` filenames safely encoded (CRLF-injection and Unicode both handled).
- `bandit`, `vulture`, `pip-audit`, `npm audit` all run; see `FINAL_SECURITY_REPORT.md` for the one documented, low-risk, unreachable-code-path finding (`ecdsa`/`python-jose`).

## Database schema summary
Four tables: `documents`, `users`, `case_assignments`, `audit_events`, plus `audit_chain_state` (one row per tenant, tracks the audit hash-chain head for concurrency-safe appends). Three linear Alembic migrations (`ec7fec2220cb` → `30f0d74f7e6e` → `ed3a4f8a50b6`), all individually verified to upgrade and downgrade cleanly against real PostgreSQL. Composite indexes on `(tenant_id, timestamp, id)` and `(tenant_id, created_at)` for the paginated audit/search queries — verified via `EXPLAIN ANALYZE` to actually get used.

## Authentication summary
Real Keycloak 26.0.7 was stood up and used throughout the later half of this engagement (not mocked). A genuine Keycloak realm-provisioning bug was found, root-caused (9 isolation tests), and documented in `ROOT_CAUSE_ANALYSIS.md`: realms created via the bare Admin REST API don't provision a working User Profile, silently blocking every password-grant login. Fixed by explicitly configuring the User Profile as part of realm setup — anyone provisioning a real realm for this app must do the same (see `ROOT_CAUSE_ANALYSIS.md`'s recommendation section).

## API summary
13 endpoints, all documented in the regenerated `openapi_export.json` (OpenAPI 3.1.0): `/health`, `/ready`, `/metrics`, `/v1/setup`, `/v1/documents`, `/v1/documents/search`, `/v1/documents/{id}/process`, `/v1/documents/{id}/content`, `/v1/documents/{id}/download`, `/v1/rag/answer`, `/v1/environmental-reviews`, `/v1/cases/{id}/assign`, `/v1/audit`.

## Frontend summary
Next.js app with two real routes: `/` (dashboard shell) and `/setup` (enterprise configuration wizard, multi-step, POSTs to `/v1/setup`). Builds and lints clean. No document-management UI (search/upload/download screens) exists yet — the backend is ready for one, but building it was explicitly out of scope for this engagement (see Known Limitations).

## Deployment summary
- `docker-compose.yml` — development topology, secrets externalized via required env vars.
- `docker-compose.production.yml` — production topology: Nginx TLS termination, health checks, restart policies, resource limits, Keycloak in production mode against real Postgres. **Never run end-to-end** (no Docker daemon in this sandbox) — every component was validated individually with the closest real tooling available instead (real `nginx -t`, a real multi-worker `uvicorn` boot, real YAML parsing).
- `Dockerfile.production` — 4 uvicorn workers, readiness-based `HEALTHCHECK`, rootless (`USER 65532:65532`).
- `.github/workflows/ci.yml` — pytest/ruff/mypy/npm build+lint/security-scan/docker-build/integration jobs. YAML-valid; every individual step was independently verified to pass in this sandbox; the workflow itself has never run on GitHub's infrastructure.
- Real SBOMs generated: `sbom-backend.cdx.json` (127 components), `sbom-frontend.cdx.json` (333 components).

## Testing summary
62 automated tests (`pytest`), all passing: authentication (JWT/JWKS edge cases), tenant isolation, search, upload/download, rate limiting, audit pagination, ingestion pipeline, environmental engine, ABAC. `ruff`, `mypy`, `bandit`, `vulture` all clean. Beyond the automated suite, extensive real-infrastructure testing was performed manually against real PostgreSQL, Redis, and Keycloak (concurrency tests up to 500 writers, chaos testing, backup/restore, live OpenTelemetry span verification) — see `FINAL_DATABASE_AUDIT.md`, `FINAL_OBSERVABILITY_REPORT.md`, and `FINAL_DEPLOYMENT_REPORT.md` for that evidence, which isn't captured in the pytest suite itself since it requires infrastructure the suite's SQLite/fakeredis fixtures don't provide.

## Known limitations
- No `statement_timeout` configured; no deadlock/retry-strategy stress test performed.
- No point-in-time (WAL-based) recovery configured — only full `pg_dump`/`pg_restore` was verified.
- No structured/JSON logging; no Grafana dashboards (Grafana is provisioned in the production compose file but has no dashboards loaded).
- No frontend document-management UI (search/upload/download screens) — a deliberate scope decision, not an oversight; the backend APIs are ready for one.
- The audit hash-chain's concurrency fix (real, verified, production-grade — see `FINAL_DATABASE_AUDIT.md`) went through one abandoned approach (a PostgreSQL advisory lock that worked in isolation but not in the real code path, root cause not fully identified) before landing on the working row-lock-based fix. This is documented transparently rather than hidden.

## Sandbox limitations (apply to every report in this engagement, not just this file)
- No Docker daemon — the full production stack has never been brought up together.
- No real OpenSearch or MinIO binary reachable (confirmed via failed download attempts against network policy, not assumed) — both have real, working, verified integrations with automatic fallback, but their primary (non-fallback) code paths have never been exercised against a live cluster/bucket.
- `trivy`'s vulnerability database is hosted outside this sandbox's network allowlist (confirmed via a direct 403) — the binary works, but image scanning was done via `pip-audit`/`npm audit` instead.
- No GitHub Actions runner, no real TLS certificate, no human penetration test.

## Production recommendations
1. Run `docker compose -f docker-compose.production.yml build && up` against a real Docker host first — this is genuinely untested territory.
2. Provision the Keycloak realm using the explicit User Profile configuration documented in `ROOT_CAUSE_ANALYSIS.md`.
3. Point at real OpenSearch/MinIO and verify their primary code paths, not just the fallbacks.
4. Obtain a real TLS certificate for the Nginx config.
5. Run image vulnerability scanning from an environment with a real network path to a scanner's database.
6. Re-run the concurrency/pagination/index benchmarks in `FINAL_DATABASE_AUDIT.md` against production-grade PostgreSQL, not this sandbox's local instance.

## Maintenance recommendations
- Keep `openapi_export.json` regenerated whenever routes change (`python -c "...app.openapi()..."`, see any `FINAL_*.md` report for the exact one-liner).
- Re-run `alembic revision --autogenerate` after any ORM model change and inspect the generated migration before committing it — this caught real, intended-only changes cleanly throughout this engagement (verified empty-migration checks confirmed zero drift when no schema change was intended).
- Keep `.env.example` in sync with `gov_platform/config.py`'s `Settings` fields — it was found out of date once already during this handoff and was corrected.
- The two-attempt audit hash-chain fix history is intentionally left in `gov_platform/audit.py`'s docstring and in `FINAL_DATABASE_AUDIT.md` — don't remove it; it documents a real investigation that a future maintainer might otherwise repeat.

## Directory overview
```
gov_platform/          FastAPI backend (main.py, security.py, audit.py, search.py, storage.py, rate_limit.py, ingestion.py, models.py, config.py, db/)
frontend/               Next.js frontend (app/, package.json)
migrations/             Alembic migrations (3, linear, verified)
tests/                  62 pytest tests + conftest.py fixtures
nginx/                  Production reverse-proxy config (validated with real nginx -t)
observability/          Prometheus scrape config
helm/, terraform/       Pre-existing IaC scaffolding (not modified this engagement)
docker-compose.yml, docker-compose.production.yml, Dockerfile, Dockerfile.production
.github/workflows/ci.yml
openapi_export.json, sbom-backend.cdx.json, sbom-frontend.cdx.json
```

## Important configuration files
`gov_platform/config.py` (all settings), `.env.example` (concrete template, kept current as of this handoff), `pyproject.toml` (dependencies, ruff/pytest/mypy config), `alembic.ini` + `migrations/env.py`.

## Backup recommendations
`pg_dump -F c` / `pg_restore` was verified end-to-end against real PostgreSQL in this engagement (full drop-and-restore cycle, data survived intact). Automate this on a schedule in production; point-in-time recovery via WAL archiving is not yet configured (see Known Limitations).

## Upgrade recommendations
Always run `alembic upgrade head` as an explicit release step — never rely on the `_lifespan`-based `create_all` auto-provisioning, which is intentionally a no-op outside `environment=development`.

## Estimated production readiness
**75/100** — see `FINAL_PRODUCTION_READINESS.md` and `FINAL_RELEASE_AUDIT.md` for the full justification. Application-layer correctness, security, and database reliability are strong and backed by real executed evidence (including a critical concurrency bug found and fixed against real PostgreSQL). The score is held back entirely by infrastructure integration that has never been exercised outside this sandbox — not by any known application defect.
