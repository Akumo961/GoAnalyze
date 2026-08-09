# FINAL_DATABASE_AUDIT.md

**Date:** 2026-08-04/05. All evidence below is from commands actually executed against a real PostgreSQL 16.14 instance in this sandbox, unless marked otherwise.

## Critical finding: audit hash chain forks under concurrent writes -- found, root-caused, fixed, verified

### Reproduction (proven, not assumed)

A direct concurrency test against real PostgreSQL, escalating from 10 to 300 simultaneous audit-append calls for the same tenant, using the original (pre-fix) code:

| Concurrency | Events persisted | Write exceptions | Forked chain positions | Events involved in a fork |
|---|---|---|---|---|
| 10 | 10 | 0 | 1 | 4-8 (varied across runs) |
| 50 | 50 | 0 | 2-4 | 36-40 |
| 100 | 100 | 0 | 3-7 | 24-80 |
| 300 | 300 | 0 | 5-15 | 28-274 |

No data was lost and no exceptions occurred -- the bug is silent corruption of the tamper-evidence property, not a crash. At 300 concurrent writers, up to 91% of events in a single run were involved in a forked chain (multiple events referencing the same `previous_hash`). This defeats the entire purpose of a hash-chained audit log: a forked chain cannot be walked as a single linear sequence to prove nothing was inserted or removed.

**Root cause:** `AuditLog.append()` read the current chain head (`SELECT ... ORDER BY timestamp DESC LIMIT 1`) and then wrote a new event referencing it, as two separate, unsynchronized steps -- a classic read-then-write race. Two concurrent appends for the same tenant could both read the same head before either committed.

### First fix attempt: PostgreSQL advisory lock -- did not work, documented honestly

The first fix wrapped the read-then-write in a `pg_advisory_xact_lock(hashtext(tenant_id))`, transaction-scoped so it auto-releases on commit/rollback with no orphaned-lock cleanup needed. **This was verified to serialize correctly in isolation** (a standalone timing test showed clean, non-overlapping acquire/release cycles across 5 concurrent lock-holders). **However, re-running the exact same concurrency reproduction test with this fix in place still produced forks at every concurrency level (10 through 300).** Deep instrumentation of the actual `append()` code path showed a burst pattern -- one write would land, then 10 subsequent writes would all read that same state as "latest" simultaneously -- inconsistent with the lock actually mutually excluding in the real call path, despite working in the isolated test. The exact mechanism was not conclusively identified before the approach was abandoned in favor of a more standard, more easily verified mechanism, per the explicit instruction not to keep debugging the advisory-lock approach indefinitely once a demonstrably-working alternative was available.

### Fix that worked: dedicated `audit_chain_state` table with `SELECT ... FOR UPDATE`

Added `AuditChainStateORM`: one row per tenant, holding `latest_event_hash`. `AuditRepository.append_with_chain_lock()`:
1. `INSERT ... ON CONFLICT DO NOTHING` to ensure the tenant's row exists (handles the first-ever-event case without a duplicate-key race).
2. `SELECT ... FOR UPDATE` on that single row -- a real Postgres row lock, blocking any other transaction trying to lock the same row until this one commits.
3. Read `latest_event_hash` (now guaranteed current, since the lock excludes concurrent readers-then-writers).
4. Compute the new event's hash, insert it, update the chain-state row, commit (which releases the row lock).

This is standard row-level locking (MVCC + explicit lock), not an advisory lock -- a more conventional, more easily reasoned-about mechanism.

### Re-verification after the fix (same reproduction script, same methodology)

| Concurrency | Events persisted | Write exceptions | Forked chain positions | Duplicate event hashes |
|---|---|---|---|---|
| 10 | 10 | 0 | **0** | 0 |
| 50 | 50 | 0 | **0** | 0 |
| 100 | 100 | 0 | **0** | 0 |
| 300 | 300 | 0 | **0** | 0 |
| 500 | 497 | **3** | **0** | 0 |

At 500 concurrent writers, 3 writes failed -- but with a genuine, distinct root cause: `remaining connection slots are reserved for roles with the SUPERUSER attribute`. This is PostgreSQL's `max_connections` limit (confirmed via `SHOW max_connections;` -> `100` in this sandbox's default config), hit because the benchmark itself requested a 100-connection pool. **This is a legitimate connection-pool-exhaustion finding, not a locking defect** -- and critically, the 497 events that did succeed still formed a single, unbroken, unforked chain with exactly one root event. The system failed *safely* under connection exhaustion (clear errors, zero corruption) rather than silently corrupting state.

### Migration verified against real PostgreSQL

```
$ alembic upgrade head
Running upgrade 30f0d74f7e6e -> ed3a4f8a50b6, add audit_chain_state table for row-locked chain appends
$ psql ... \d audit_chain_state
   tenant_id (varchar, PK) | latest_event_hash (varchar, nullable)
$ alembic downgrade -1
Running downgrade ed3a4f8a50b6 -> 30f0d74f7e6e
Did not find any relation named "audit_chain_state".   <- confirmed dropped
$ alembic upgrade head    <- re-applied cleanly
```

### Benchmark: throughput/latency cost of the fix

Both measured with the same methodology (100 writes, same tenant, real PostgreSQL, real wall-clock timing):

| | Before (unprotected) | After (row-locked) |
|---|---|---|
| Wall time (100 writes) | 1745.7ms | 1985.2ms |
| Throughput | 57.3 writes/sec | 50.4 writes/sec |
| Correctness | Forked chain (proven above) | Zero forks (proven above) |

**~12% throughput reduction** for full correctness under concurrent same-tenant writes -- a modest, well-justified cost. Different tenants do not block each other (each has its own chain-state row); a multi-tenant benchmark (10 tenants, 100 total writes) showed comparable wall-clock time to the single-tenant case, indicating the bottleneck at this scale is per-write round-trip count rather than lock contention across tenants.

## Regression testing

- `pytest`: 62/62 passed (up from 61 -- added `test_audit_chain_lock_produces_correct_linear_chain`, a SQLite-path functional regression test; true concurrency correctness cannot be tested against SQLite's single-writer model, so that remains validated only by the standalone real-PostgreSQL scripts above).
- `ruff check gov_platform tests migrations`: clean (also fixed pre-existing style issues in the two newly autogenerated migration files).
- `mypy gov_platform --ignore-missing-imports`: clean.

## Other database reliability checks executed this session

- **Concurrent document creation:** 50 concurrent `DocumentRepository.create()` calls against real Postgres, distinct sessions -- all 50 succeeded, exactly 50 rows created (no duplicates, no lost writes).
- **Transaction rollback:** a real transaction with a document insert followed by a deliberate unique-constraint violation (duplicate `users.subject`) -- confirmed the transaction raised `IntegrityError`, and confirmed the document insert from the *same* transaction was **not** persisted afterward (real rollback, not partial commit).
- **Missing composite indexes (performance, not correctness):** `EXPLAIN ANALYZE` on the new paginated `audit_events` query, before any composite index existed, showed a Bitmap Heap Scan + full in-memory Sort over all matching rows (15.47ms, scaling with total tenant row count regardless of requested page). Added `ix_audit_events_tenant_id_timestamp_id (tenant_id, timestamp, id)` and `ix_documents_tenant_id_created_at (tenant_id, created_at)`, both via a real Alembic migration verified to upgrade/downgrade cleanly. Re-ran the same `EXPLAIN ANALYZE`: **0.53ms, Index Scan instead of Bitmap+Sort (~29x faster)**, with a query plan whose cost now scales with `OFFSET + LIMIT` rather than total table size.

## Connection pool sizing -- found and fixed (independent audit follow-up)

Direct inspection of `get_engine()` confirmed the app was relying on SQLAlchemy's own unconfigured defaults: `pool_size=5, max_overflow=10` (verified via `engine.pool.size()`/`_max_overflow`), a hard cap of 15 total connections per process with no tuning knob. Added `database_pool_size`/`database_max_overflow`/`database_pool_timeout_seconds` settings, wired into `get_engine()` (Postgres only -- SQLite's pooling class doesn't accept these kwargs, confirmed it still constructs correctly via the SQLite-specific branch). Re-verified: setting `GOV_DATABASE_POOL_SIZE=15`/`GOV_DATABASE_MAX_OVERFLOW=25` produces a real engine with exactly those values.

## Not executed this session

- Deadlock-handling and retry-strategy testing under adversarial lock-ordering (e.g., two transactions each locking resources in opposite order) -- not attempted; the current schema/access patterns don't have an obvious multi-table lock-ordering hazard, but this wasn't specifically stress-tested.
- Long-running-query / statement-timeout behavior -- not configured or tested (no `statement_timeout` is currently set at the connection or session level).
- Point-in-time recovery -- `pg_dump`/`pg_restore` full-database backup/restore was verified in an earlier session (see `FINAL_DEPLOYMENT_REPORT.md`); WAL-based point-in-time recovery specifically was not set up or tested (would require `archive_mode`/WAL archiving configuration not currently present).
