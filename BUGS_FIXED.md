# BUGS_FIXED.md

**Date:** 2026-08-04. This file tracks bugs found and fixed during this session's production audit. See `FINAL_EXECUTION_REPORT.md` / `FINAL_SECURITY_REPORT.md` / `ROOT_CAUSE_ANALYSIS.md` for bugs found in earlier sessions of this engagement.

## This session

### 1. `GET /v1/audit` returned the complete, unbounded audit history

**Severity:** Medium (real production scalability issue, not currently exploitable but a genuine operational risk).

**Found by:** manual code audit of `gov_platform/main.py` -- noticed every other list-style endpoint (`/v1/documents/search`) had `page`/`page_size` pagination, but `/v1/audit` did not.

**Evidence of the bug (before fix), measured directly:**
```
BEFORE (unbounded): 5000 rows returned, 175.01ms, 1 SELECT query
```
5000 was an arbitrary seeded volume for the benchmark; in a real government deployment with years of audit history per tenant, this endpoint would eventually return an unbounded, ever-growing payload with no way for a client to request less.

**Fix:**
- `gov_platform/db/repositories.py`: added `AuditRepository.list_for_tenant_paginated(tenant_id, page, page_size)` -- a separate `COUNT(*)` query (no rows loaded) plus a `LIMIT`/`OFFSET` query ordered by `(timestamp, id)` for full determinism even when timestamps collide. The old unbounded `list_for_tenant()` method was kept (not removed) since it's still needed internally, but the public API route no longer uses it.
- Deduplicated three near-identical ORM-to-domain-model conversions into a single `_orm_to_domain()` static method while making this change (found as a side effect -- straightforward, low-risk cleanup).
- `gov_platform/models.py`: added `AuditEventListResponse` (`total`, `page`, `page_size`, `total_pages`, `items`) -- matches the exact pagination shape already used by `SearchResponse`, per the explicit instruction not to invent a new style.
- `gov_platform/main.py`: `GET /v1/audit` now accepts `page`/`page_size` query parameters with the same validation as the search endpoint (`page >= 1`, `1 <= page_size <= 100`, both returning `422` on violation).
- Tenant isolation and authorization: **unchanged** -- the same `context.tenant_id` filter is applied exactly as before; no route-level auth logic was touched.

**Evidence of the fix, measured directly (same benchmark, same 5000-row dataset):**
```
AFTER (paginated, page_size=20): 20 rows returned (total=5000), 7.60ms, 2 SELECT queries (1 COUNT + 1 SELECT)

Rows transferred: 5000 -> 20 (99.6% reduction)
Latency: 175.01ms -> 7.60ms
```
23x latency reduction, 99.6% reduction in rows transferred, at the cost of one additional lightweight `COUNT(*)` query per request (2 total vs. 1) -- a standard, well-understood tradeoff for pagination.

**Tests added:** `tests/test_audit_pagination.py`, 11 new tests -- first page, middle page, last (partial) page, empty page past the end, empty tenant, invalid `page`, invalid `page_size`, maximum allowed `page_size`, tenant isolation under pagination, authentication requirement, and ordering determinism/consistency across repeated and sequential page fetches.

**Existing tests updated:** `tests/test_tenant_isolation.py::test_audit_endpoint_only_returns_own_tenant_events` -- updated its assertions from the old bare-list response shape to the new `{"items": [...], "total": ...}` shape. `tests/test_rate_limit.py`'s uses of `/v1/audit` only asserted status codes, not body shape, so needed no changes.

**Regression result:** full suite re-run after the fix: **61/61 passed** (was 50 before this session's new tests), `ruff` clean, `mypy` clean.

**OpenAPI:** regenerated and confirmed -- `GET /v1/audit` now documents `page`/`page_size` query parameters and the `AuditEventListResponse` schema (`total`, `page`, `page_size`, `total_pages`, `items`).

### 2. `bandit` false-positive reviewed and documented (not a real bug, noted for completeness)

Running `bandit -r gov_platform` for the first time this session flagged `B105` (hardcoded password string) on `config.py`'s `_INSECURE_DEFAULT_AUDIT_SECRET` constant. Reviewed: this is the deliberate sentinel value that `_validate_production_secrets()` checks for and **rejects** at startup -- it is not a credential in use. Added a `# nosec B105` comment with an inline explanation so future scans and reviewers don't have to re-derive this.

## Audit checklist coverage this session

Ran, for the first time in this engagement: `vulture` (dead code, 0 real findings at 60% and 80% confidence -- all flagged items were framework-managed code like route handlers and Pydantic fields, correctly not real dead code), `bandit` (1 finding, false positive as above), and a direct grep for blocking I/O in async functions (`time.sleep`, `requests.*`, bare `open()`) inside `gov_platform/*.py` -- zero matches, confirming all I/O already goes through async-native paths (`httpx.AsyncClient` for HTTP, `run_in_threadpool` for the sync MinIO SDK, `aiosqlite`/`asyncpg` for the database).

## Follow-up session: critical concurrency bug in the audit hash chain

### 3. Audit hash chain forks under concurrent writes (Critical -- data integrity)

**Found by:** direct concurrency testing against real PostgreSQL while investigating "duplicate audit writes" as part of the database reliability audit -- not a hypothetical, a reproduced and quantified defect.

**Severity:** Critical. The audit log's entire tamper-evidence guarantee depends on forming a single linear hash chain; under real concurrent writes (any two API requests writing audit events for the same tenant at close to the same time -- a completely normal production scenario, not an edge case), the chain forked. At 300 concurrent writers, up to 91% of events in a run were involved in a fork.

**Root cause:** classic read-then-write race -- `AuditLog.append()` read the current chain head, then wrote a new event referencing it, as two unsynchronized steps.

**Fix (after a first attempt that didn't work -- see `FINAL_DATABASE_AUDIT.md` for the full honest account):** a dedicated `audit_chain_state` table (one row per tenant) locked via real PostgreSQL `SELECT ... FOR UPDATE` row locking before reading the chain head and writing the next event, all in one transaction.

**Verified:** re-ran the exact same reproduction methodology (10/50/100/300/500 concurrent writers against real PostgreSQL) -- **zero forks at every level**, including the 500-writer run where 3 writes failed on a legitimate, distinct connection-pool-exhaustion error (not a locking defect) and the other 497 still formed one clean, unforked chain.

**Cost:** ~12% throughput reduction (57.3 -> 50.4 writes/sec, measured) for same-tenant concurrent writes -- different tenants aren't blocked by each other's locks.

**Tests:** added `test_audit_chain_lock_produces_correct_linear_chain` (SQLite-path functional regression). True concurrency correctness is validated only by the standalone real-PostgreSQL scripts documented in `FINAL_DATABASE_AUDIT.md`, since SQLite's single-writer model can't exercise a real race.

**Regression:** full suite re-run after the fix: 62/62 passed, `ruff` clean, `mypy` clean.

## Independent audit follow-up: connection pool sizing

### 4. Database connection pool size was an invisible SQLAlchemy default, not exposed for tuning (Medium)

**Found by:** direct inspection of `gov_platform/db/session.py`'s `get_engine()` -- confirmed via a live check that `create_async_engine()` was called with no `pool_size`/`max_overflow` arguments, so SQLAlchemy's own defaults applied: `pool_size=5, max_overflow=10` (confirmed via `engine.pool.size()` -> `5`, `engine.pool._max_overflow` -> `10`), giving a hard cap of **15 total database connections per application process** with no way to change it without a code edit.

**Why this matters:** this ties directly into the connection-exhaustion behavior observed during the audit-chain-lock 500-writer benchmark (`FINAL_DATABASE_AUDIT.md`) -- an unconfigured production deployment would exhaust its own 15-connection pool (producing pool checkout timeouts) long before ever approaching PostgreSQL's own `max_connections` limit (100 in this sandbox's default config), with no visibility or tuning knob for operators.

**Fix:** added `database_pool_size` (default 10), `database_max_overflow` (default 20), and `database_pool_timeout_seconds` (default 30) to `Settings`, wired into `get_engine()`. SQLite (test/offline use only) is explicitly excluded from these kwargs, since its pooling class doesn't accept them.

**Verified:** direct check that `GOV_DATABASE_POOL_SIZE=15`/`GOV_DATABASE_MAX_OVERFLOW=25` env vars actually produce a real Postgres engine with `pool.size()==15` and `_max_overflow==25`; separately confirmed the SQLite path still constructs an engine without error (it takes a different code path that skips the now-Postgres-only kwargs).

**Regression:** 62/62 passed, `ruff` clean, `mypy` clean.
