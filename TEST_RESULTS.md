# TEST_RESULTS.md

All results below are from commands actually executed in this session
(2026-08-02), not projected or assumed. Docker-based validation is called
out separately as **not executed** (no Docker daemon in this sandbox).

## Backend — pytest

```
$ python -m pytest tests/ -v
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.6.0
plugins: anyio-4.14.2, asyncio-1.4.0
asyncio: mode=Mode.AUTO
collecting ... collected 23 items

tests/test_auth.py::test_valid_token_is_accepted PASSED
tests/test_auth.py::test_expired_token_is_rejected PASSED
tests/test_auth.py::test_wrong_audience_is_rejected PASSED
tests/test_auth.py::test_wrong_issuer_is_rejected PASSED
tests/test_auth.py::test_forged_signature_is_rejected PASSED
tests/test_auth.py::test_missing_tenant_claim_is_rejected PASSED
tests/test_auth.py::test_legacy_colon_format_dev_token_is_no_longer_valid PASSED
tests/test_auth.py::test_dev_header_bypass_disabled_by_default PASSED
tests/test_environmental_engine.py::test_missing_documents_drive_admissibility_and_risk PASSED
tests/test_ingestion.py::test_pipeline_runs_all_ten_stages_in_order PASSED
tests/test_ingestion.py::test_pipeline_classifies_and_scores_risk_from_text PASSED
tests/test_ingestion.py::test_pipeline_handles_empty_text_without_error PASSED
tests/test_ingestion.py::test_pipeline_appends_hash_chained_audit_event PASSED
tests/test_security.py::test_abac_rejects_cross_tenant_access PASSED
tests/test_security.py::test_abac_allows_protected_b_with_role PASSED
tests/test_tenant_isolation.py::test_documents_endpoint_rejects_unauthenticated_requests PASSED
tests/test_tenant_isolation.py::test_documents_endpoint_rejects_forged_legacy_token PASSED
tests/test_tenant_isolation.py::test_valid_token_can_ingest_own_tenant_document PASSED
tests/test_tenant_isolation.py::test_cannot_ingest_document_for_another_tenant PASSED
tests/test_tenant_isolation.py::test_rag_answer_requires_authentication PASSED
tests/test_tenant_isolation.py::test_rag_answer_rejects_citation_from_other_tenant PASSED
tests/test_tenant_isolation.py::test_rag_answer_allows_citation_from_own_tenant PASSED
tests/test_tenant_isolation.py::test_audit_endpoint_only_returns_own_tenant_events PASSED

============================== 23 passed in 2.20s ===============================
```

**Coverage added this engagement:**
- `test_auth.py` (8 tests) — JWKS-based JWT verification: valid token, expired,
  wrong audience, wrong issuer, forged signature, missing tenant claim, the
  historical forged-string-token vulnerability specifically, and the dev
  header-bypass lockdown.
- `test_tenant_isolation.py` (8 tests) — live API integration tests via
  `httpx.AsyncClient` against the real FastAPI app (SQLite-backed): auth
  enforcement on `/v1/documents` and `/v1/rag/answer`, cross-tenant document
  ingestion rejection (403), cross-tenant RAG citation rejection (403), and
  audit log tenant scoping.
- `test_ingestion.py` (4 tests, pre-existing, updated) — converted to the
  new async, DB-backed pipeline signature.

## Backend — static analysis (ruff)

```
$ ruff check gov_platform tests migrations
All checks passed!
```

Started at 46 findings (mostly import ordering, `datetime.UTC` alias,
FastAPI's `Depends()`-as-default idiom being misflagged); fixed with
`ruff --fix` plus one project-level ignore for the FastAPI-specific rule
(`B008`, a documented false positive for that framework) and one manual
rewrite. Zero findings remain.

## Backend — Alembic migrations

```
$ alembic upgrade head
INFO  Running upgrade  -> ec7fec2220cb, initial schema: documents, users, case_assignments, audit_events

$ alembic downgrade base
INFO  Running downgrade ec7fec2220cb -> , initial schema: documents, users, case_assignments, audit_events
```
Run against a throwaway SQLite file (`GOV_DATABASE_URL=sqlite+aiosqlite:///...`)
since no PostgreSQL server is available in this sandbox. The same
`env.py`/model metadata targets `asyncpg`/PostgreSQL in production without
code changes — only the URL differs.

## Backend — live server smoke test

Started with `uvicorn gov_platform.main:app`, SQLite-backed, `GOV_ALLOW_INSECURE_DEV_AUTH=false`:

| Request | Expected | Actual |
|---|---|---|
| `GET /health` | 200 | `200 {"status":"ok",...}` |
| `POST /v1/documents` with no auth | 401 | `401 {"detail":"missing_or_invalid_bearer_token"}` |
| `POST /v1/documents` with forged `Bearer tenant:ministry-a:platform-admin` | 401 | `401 {"detail":"malformed_token"}` |
| `POST /v1/documents` with spoofed `x-tenant-id`/`x-roles` headers, dev bypass OFF | 401 | `401 {"detail":"missing_or_invalid_bearer_token"}` |

With the dev bypass explicitly enabled (`GOV_ALLOW_INSECURE_DEV_AUTH=true`,
`GOV_ENVIRONMENT=development`) — confirming it still works for local
iteration when opted into, and confirming a real signed JWT flow end to end:
document ingestion, cross-tenant 403s, and RAG citation authorization were
all additionally verified via the `test_tenant_isolation.py` integration
suite above (which exercises the real app object, not mocks).

## Frontend

```
$ npm install
found 0 vulnerabilities

$ npm audit
found 0 vulnerabilities

$ npm run lint
> eslint .
(no output — zero findings)

$ npm run build
▲ Next.js 16.2.12 (Turbopack)
✓ Compiled successfully in 8.0s
✓ Generating static pages using 1 worker (4/4)

Route (app)
┌ ○ /
├ ○ /_not-found
└ ○ /setup
```

## Docker Compose — NOT executed

`docker compose build` / `docker compose up` were **not run**: no Docker
daemon is available in this sandbox (`docker: command not found`). What
*was* validated:
- `docker-compose.yml` parses as valid YAML (`yaml.safe_load`).
- Every service that previously had a hardcoded credential now requires an
  environment variable with no insecure fallback (`${VAR:?error message}`),
  matching the variables documented in `.env.example`.
- The root `Dockerfile`'s `pip install .` step will succeed given the
  packaging fix (verified indirectly: the exact same `pip install -e .`
  command that Dockerfile relies on was run and succeeded in this session).

**This remains the single biggest unverified area.** A real environment
with Docker available should run `docker compose build && docker compose up`
and confirm all 13 services reach a healthy state before this is called
fully production-validated.
