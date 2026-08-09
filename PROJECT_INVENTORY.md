# PROJECT_INVENTORY.md

An accurate inventory of what exists in this repository as of handoff. Nothing below is aspirational — every item was directly inspected.

## Backend structure (`gov_platform/`)

| File | Purpose |
|---|---|
| `main.py` | FastAPI app: route definitions, middleware (CORS, security headers, IP rate limiting), OpenTelemetry init, exception handling, lifespan (dev-only table auto-create, tracing shutdown flush) |
| `config.py` | `Settings` (pydantic-settings): all `GOV_`-prefixed environment variables, production-safety validators |
| `security.py` | JWT/JWKS verification (Keycloak), ABAC policy evaluation, `get_current_context` dependency |
| `audit.py` | Hash-chained audit log; `append()` uses row-locked chain-state writes for concurrency safety |
| `search.py` | Document search: OpenSearch REST integration with automatic database fallback |
| `storage.py` | Object storage: MinIO SDK integration with automatic in-memory fallback |
| `rate_limit.py` | Redis-backed fixed-window rate limiting (per-IP/user/tenant) |
| `ingestion.py` | Document ingestion pipeline (OCR stub → classification → extraction → compliance → risk → indexing → workflow → audit) |
| `environmental_engine.py` | Environmental/regulatory review logic |
| `workflows.py` | Case assignment engine |
| `rag.py` | Evidence-grounded RAG answer service |
| `models.py` | Pydantic domain models (requests/responses/domain objects) |
| `db/models.py` | SQLAlchemy ORM models: `DocumentORM`, `UserORM`, `CaseAssignmentORM`, `AuditEventORM`, `AuditChainStateORM` |
| `db/session.py` | Async engine/session factory, configurable connection pool |
| `db/repositories.py` | Repository layer: `DocumentRepository`, `CaseRepository`, `UserRepository`, `AuditRepository` |

## Frontend structure (`frontend/`)

- `app/page.tsx` — dashboard shell (route `/`)
- `app/setup/page.tsx` — enterprise configuration wizard (route `/setup`), POSTs to `/v1/setup`
- `app/layout.tsx`, `app/styles.css` — shared layout/styling
- `package.json`, `tsconfig.json`, `eslint.config.mjs`, `next.config.mjs` — tooling config
- `Dockerfile` — frontend container build
- No document-management UI (search/upload/download screens) exists — the backend APIs support this, but no frontend was built for it.

## API endpoints (13, confirmed via regenerated OpenAPI schema)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness probe (no dependency checks) |
| GET | `/ready` | Readiness probe (real DB connectivity check) |
| GET | `/metrics` | Prometheus exposition format |
| POST | `/v1/setup` | Enterprise configuration wizard submission |
| POST | `/v1/documents` | Ingest document metadata |
| GET | `/v1/documents/search` | Full-text search, paginated, tenant-isolated |
| POST | `/v1/documents/{id}/process` | Run the ingestion pipeline |
| PUT | `/v1/documents/{id}/content` | Upload original file bytes |
| GET | `/v1/documents/{id}/download` | Download original file bytes |
| POST | `/v1/rag/answer` | Evidence-grounded RAG answer |
| POST | `/v1/environmental-reviews` | Environmental/regulatory review |
| POST | `/v1/cases/{id}/assign` | Case assignment |
| GET | `/v1/audit` | Paginated tenant audit log |

## Database migrations (`migrations/versions/`, 3 files, linear history)

1. `ec7fec2220cb` — initial schema: `documents`, `users`, `case_assignments`, `audit_events`
2. `30f0d74f7e6e` — composite indexes for tenant-scoped pagination (`documents(tenant_id, created_at)`, `audit_events(tenant_id, timestamp, id)`)
3. `ed3a4f8a50b6` — `audit_chain_state` table (row-locked concurrency-safe audit appends)

All three verified to upgrade and downgrade cleanly against real PostgreSQL 16.14.

## Tests (`tests/`, 9 files + `conftest.py`, 62 tests total)

`test_auth.py`, `test_tenant_isolation.py`, `test_search.py`, `test_download.py`, `test_rate_limit.py`, `test_audit_pagination.py`, `test_ingestion.py`, `test_security.py`, `test_environmental_engine.py`, `conftest.py` (shared fixtures: SQLite test DB, in-memory object storage, JWT signing helpers).

## Deployment files

- `Dockerfile` — dev/base backend image (rootless, `USER 65532:65532`)
- `Dockerfile.production` — 4 uvicorn workers, readiness-based `HEALTHCHECK`
- `docker-compose.yml` — development topology, secrets externalized
- `docker-compose.production.yml` — production topology: Nginx TLS termination, health checks, restart policies, resource limits (never run end-to-end in this sandbox — no Docker daemon)
- `nginx/nginx.conf` — reverse proxy, TLS, HSTS/security headers (validated with real `nginx -t`)
- `alembic.ini`, `migrations/env.py` — migration tooling

## Infrastructure configuration (pre-existing, not modified this engagement)

- `helm/goanalyze-government/` — Helm chart (`Chart.yaml`, `values.yaml`, `templates/api-deployment.yaml`)
- `terraform/` — `main.tf`, `values/goanalyze-values.yaml`

## CI/CD (`.github/`)

- `workflows/ci.yml` — authored/validated this engagement: pytest/ruff/mypy/npm build+lint/security-scan/docker-build/integration jobs. YAML-valid; individual steps independently verified to pass in this sandbox; never run on GitHub's infrastructure.
- `workflows/stale.yml`, `workflows/manualPush.yml`, `workflows/docker-build-push.yml`, `workflows/release-to-discord.yml`, `FUNDING.yml`, `ISSUE_TEMPLATE/` — pre-existing repository scaffolding, not modified or verified this engagement.

## Observability

- `observability/prometheus.yml` — scrape config targeting `/metrics`
- OpenTelemetry: FastAPI + httpx + SQLAlchemy auto-instrumentation, `ConsoleSpanExporter` (development fallback) or OTLP (if `GOV_OTEL_EXPORTER_OTLP_ENDPOINT` is set and the exporter package is available), verified live (real spans captured for all three instrumented layers, including recorded exceptions on a real failed outbound call)
- No structured/JSON logging; no Grafana dashboards exist (Grafana is provisioned as a container in the production compose file, with no dashboards loaded)

## Security configuration

- Real Keycloak JWKS-based JWT verification (signature, issuer, audience, expiration)
- ABAC: tenant/role/classification/purpose checks on every route
- Redis-backed rate limiting (per-IP/user/tenant, fails open)
- Security headers middleware (CSP, X-Frame-Options, X-Content-Type-Options, conditional HSTS)
- No hardcoded secrets; production boot fails fast on unsafe config (`GOV_AUDIT_HASH_SECRET`, `GOV_ALLOW_INSECURE_DEV_AUTH`)
- Storage keys always server-derived; upload size capped; `Content-Disposition` filenames safely encoded

## Documentation (repository root)

Extensive `.md` documentation exists at the repository root, spanning both pre-existing project documents (`ARCHITECTURE.md`, `BUSINESS_CASE.md`, `EXECUTIVE_SUMMARY.md`, `SECURITY.md`, `PRIVACY_POLICY.md`, `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `COMPETITIVE_ANALYSIS.md`, `PROCUREMENT_POSITIONING.md`, `COST_BENEFIT_ANALYSIS.md`) and this engagement's audit/validation reports (`BUGS_FIXED.md`, `BUGS_FOUND.md`, `EXECUTION_EVIDENCE.md`, `FINAL_DATABASE_AUDIT.md`, `FINAL_DEPLOYMENT_REPORT.md`, `FINAL_EXECUTION_REPORT.md`, `FINAL_OBSERVABILITY_REPORT.md`, `FINAL_PRODUCTION_READINESS.md`, `FINAL_PROJECT_HEALTH.md`, `FINAL_RELEASE_AUDIT.md`, `FINAL_SECURITY_REPORT.md`, `FINAL_TEST_RESULTS.md`, `FINAL_VALIDATION_REPORT.md`, `PRODUCTION_READINESS.md`, `PRODUCTION_READINESS_REPORT.md`, `PROJECT_COMPLETENESS_REPORT.md`, `PROJECT_HEALTH_REPORT.md`, `TEST_RESULTS.md`, `ROOT_CAUSE_ANALYSIS.md`, `FEATURE_COMPLETION_REPORT.md`, `README.md`, `HANDOFF.md`, `RELEASE_NOTES.md`, this file). Generated artifacts also present at the root: `openapi_export.json`, `sbom-backend.cdx.json`, `sbom-frontend.cdx.json`.

## Environment variables (see `.env.example` for the authoritative, current template)

Grouped by area: service identity/environment; database URL + connection pool sizing (`GOV_DATABASE_POOL_SIZE`/`MAX_OVERFLOW`/`POOL_TIMEOUT_SECONDS`); Redis; OpenSearch (`GOV_OPENSEARCH_URL`/`INDEX`); MinIO (`GOV_MINIO_ENDPOINT`/`ACCESS_KEY`/`SECRET_KEY`/`BUCKET`/`SECURE`); Keycloak (`GOV_KEYCLOAK_ISSUER`/`AUDIENCE`/`JWKS_URL`); dev-auth bypass toggle; audit secret; CORS origins; rate limiting (per-IP/user/tenant limits + enable flag); OpenTelemetry (`GOV_OTEL_TRACING_ENABLED`, `GOV_OTEL_EXPORTER_OTLP_ENDPOINT`).

## Known limitations (confirmed, not speculative)

- No Docker daemon in this sandbox — `docker-compose.production.yml` has never been run end-to-end.
- No real OpenSearch or MinIO binary reachable — both have working, verified automatic fallback behavior, but their primary (non-fallback) code paths have never been exercised against live infrastructure.
- No real Keycloak realm/user provisioning automation exists yet in the deployment files — realm setup was done manually via the Admin REST API during testing, and a real provisioning bug was found and documented (`ROOT_CAUSE_ANALYSIS.md`).
- No `statement_timeout`, deadlock/retry-strategy stress testing, or point-in-time (WAL) recovery configured.
- No structured/JSON logging, no Grafana dashboards.
- No frontend document-management UI (search/upload/download screens).
- No GitHub Actions execution, no real TLS certificate, no human penetration test.
