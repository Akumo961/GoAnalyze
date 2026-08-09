# EXECUTION_EVIDENCE.md

**Date:** 2026-08-04. Every command below was actually run in this session; output is real. This file covers the audit-endpoint pagination fix and the code-audit pass it came from -- see other `FINAL_*.md` reports for the full cumulative evidence base from earlier sessions in this engagement (real Postgres/Redis/Keycloak, chaos testing, OpenTelemetry, SBOMs, etc.).

## Code audit tooling actually run

```
$ ruff check gov_platform --select F401,F841,ERA001
All checks passed!

$ pip install vulture && vulture gov_platform --min-confidence 80
(no output -- zero findings)

$ vulture gov_platform --min-confidence 60
(only framework-managed false positives: route handlers, Pydantic fields --
reviewed individually, none are real dead code)

$ pip install bandit && bandit -r gov_platform
1 finding: B105 hardcoded_password_string in config.py
-> reviewed: false positive, the flagged constant is a rejected sentinel
   value, not a credential in use. Documented with a `# nosec` comment.

$ grep -rn "time\.sleep\|requests\.\(get\|post\|put\)\|open(" gov_platform/*.py
(no matches -- no blocking I/O found in async code paths)

$ grep -rn "TODO\|FIXME\|XXX" gov_platform/ --include="*.py"
(no matches)
```

## The pagination fix itself

```
$ python -m pytest tests/ -v
...
tests/test_audit_pagination.py::test_audit_first_page PASSED
tests/test_audit_pagination.py::test_audit_middle_page PASSED
tests/test_audit_pagination.py::test_audit_last_page_partial PASSED
tests/test_audit_pagination.py::test_audit_empty_page_past_end PASSED
tests/test_audit_pagination.py::test_audit_empty_tenant_no_events PASSED
tests/test_audit_pagination.py::test_audit_invalid_page_rejected PASSED
tests/test_audit_pagination.py::test_audit_invalid_page_size_rejected PASSED
tests/test_audit_pagination.py::test_audit_maximum_page_size_accepted PASSED
tests/test_audit_pagination.py::test_audit_pagination_respects_tenant_isolation PASSED
tests/test_audit_pagination.py::test_audit_requires_authentication PASSED
tests/test_audit_pagination.py::test_audit_ordering_is_deterministic_and_consistent_across_pages PASSED
... (50 pre-existing tests, including the updated
     test_audit_endpoint_only_returns_own_tenant_events, also PASSED)

============================= 61 passed in 9.45s ==============================

$ ruff check gov_platform tests migrations
All checks passed!

$ mypy gov_platform --ignore-missing-imports
Success: no issues found in 17 source files
```

## OpenAPI regeneration and inspection

```
$ python3 -c "...app.openapi()..."
parameters: ['page', 'page_size']
response schema ref: dict_keys(['total', 'page', 'page_size', 'total_pages', 'items'])
```
Confirmed by direct inspection of the generated schema, not assumed from the code alone.

## Performance benchmark (real, measured, not estimated)

Standalone script against a real (in-memory SQLite, same ORM/repository code path as production) database, seeded with 5,000 real audit event rows:

```
seeded 5000 audit events

BEFORE (unbounded): 5000 rows returned, 175.01ms, 1 SELECT query
AFTER (paginated, page_size=20): 20 rows returned (total=5000), 7.60ms, 2 SELECT queries (1 COUNT + 1 SELECT)

Rows transferred: 5000 -> 20 (99.6% reduction)
Latency: 175.01ms -> 7.60ms
```

Query counting was done via a real SQLAlchemy `before_cursor_execute` event listener counting actual `SELECT` statements sent to the database driver -- not inferred from the code.

## Not executed this session (out of scope / already covered elsewhere)

- Docker, real OpenSearch, real MinIO: unchanged from every prior report in this engagement -- still unavailable in this sandbox.
- Full re-run of the chaos/backup/restore/Keycloak/OpenTelemetry verification: not repeated, since no code in those areas changed this session. See `FINAL_OBSERVABILITY_REPORT.md`, `ROOT_CAUSE_ANALYSIS.md`, and `FINAL_DEPLOYMENT_REPORT.md` for that evidence.

## Addendum: audit hash-chain concurrency bug (found, root-caused, fixed, verified)

Full narrative and data tables in `FINAL_DATABASE_AUDIT.md`. Command/evidence summary:

```
# Reproduction (before fix) -- real PostgreSQL, escalating concurrency
$ python3 /tmp/reproduce_fork.py
concurrency=10:  forks=1   (up to 8 events involved)
concurrency=50:  forks=2-4 (up to 40 events involved)
concurrency=100: forks=3-7 (up to 80 events involved)
concurrency=300: forks=5-15 (up to 274 events involved -- 91% of the run)

# First fix (pg_advisory_xact_lock) -- verified working in isolation...
$ python3 <isolated lock timing script>
worker 0: acquired +0.0ms / released +51.6ms
worker 1: acquired +51.8ms / released +103.5ms   <- clean serialization
...

# ...but did NOT fix the real bug when re-tested end to end
$ python3 /tmp/reproduce_fork.py   (with the advisory-lock fix applied)
concurrency=10:  forks=2   <- still forking
concurrency=300: forks=5-6

# Second fix (audit_chain_state + SELECT...FOR UPDATE) -- verified working
$ python3 /tmp/reproduce_fork.py   (with the row-lock fix applied)
concurrency=10:  forks=0
concurrency=50:  forks=0
concurrency=100: forks=0
concurrency=300: forks=0
concurrency=500: forks=0 (3/500 writes failed on real connection-pool
                           exhaustion, a distinct, legitimate finding --
                           the 497 successful writes formed one clean chain)

$ alembic upgrade head / downgrade -1 / upgrade head
(all three steps succeeded against real PostgreSQL; downgrade confirmed
 via \d audit_chain_state reporting "Did not find any relation")

$ python -m pytest tests/ -q
62 passed in 9.95s

$ ruff check gov_platform tests migrations
All checks passed!

$ mypy gov_platform --ignore-missing-imports
Success: no issues found in 17 source files
```

## Addendum: independent production audit pass (Phases 1-4 of the follow-up audit)

**Confirmed via direct inspection/execution, not assumed:**

```
# N+1 query check: grepped gov_platform/main.py for per-item loops with
# awaited calls inside; the only loop found (rag_answer's citation check)
# operates on an already-batched get_many() result -- confirmed not N+1.
$ grep -n "for .* in .*:" gov_platform/main.py
main.py:397:    for citation in citations:   <- iterates a pre-fetched dict, no per-item query

# Composite index actually used by the real documents search fallback query:
$ psql ... -c "EXPLAIN ANALYZE SELECT * FROM documents WHERE tenant_id = ... ORDER BY created_at DESC LIMIT 20;"
Index Scan Backward using ix_documents_tenant_id_created_at on documents
Execution Time: 2.044 ms

# Connection pool: confirmed the app was silently using SQLAlchemy's own
# defaults (5 + 10 = 15 total connections), not exposed for tuning.
$ python3 -c "...get_engine()...print(engine.pool.size(), engine.pool._max_overflow)"
5 10
# Fixed (see BUGS_FIXED.md #4). Re-verified after the fix:
15 25   (with GOV_DATABASE_POOL_SIZE=15 GOV_DATABASE_MAX_OVERFLOW=25 set)

# Re-ran bandit after the pool-sizing fix
$ bandit -r gov_platform
No issues identified. (1 finding correctly suppressed via documented #nosec)

# Checked for unsafe subprocess/eval/pickle/yaml.load usage anywhere in the app
$ grep -rn "subprocess\|eval(\|pickle\.\|yaml.load(" gov_platform/*.py
(no matches)

$ python -m pytest tests/ -q
62 passed in 10.61s
$ ruff check gov_platform tests migrations
All checks passed!
$ mypy gov_platform --ignore-missing-imports
Success: no issues found in 17 source files
```

**No further confirmed defects were found in this pass.** Items reviewed and found to already be correct (not re-fixed, since nothing was wrong): security headers, CORS, tenant isolation, SQL injection (parameterized ORM throughout), authentication/authorization checks on every route, OpenAPI schema consistency for the paginated endpoints. Items reviewed and found to be genuine, pre-existing, *undone* work rather than new bugs (see `FINAL_DATABASE_AUDIT.md`'s "Not executed this session" list): no `statement_timeout` configured, no deadlock/retry-strategy stress test, no point-in-time recovery setup.
