# FINAL_OBSERVABILITY_REPORT.md

**Date:** 2026-08-04. Every claim below is either **executed** (a command was run and its output inspected), **verified** (behavior was directly observed, e.g. via a live HTTP request), **generated** (a file/artifact was produced), or explicitly marked **not executable in this sandbox**.

## 1. `_init_tracing()` — executed and verified

- **Executed:** `python3 -c "import gov_platform.main"` with `logging.basicConfig(level=logging.INFO)` forced on. Import completed without raising.
- **Verified:** the function's own log line (`"OpenTelemetry: exporting spans to console (development fallback)."`) appeared, proving the function ran to completion rather than being silently swallowed by its outer `try/except`.
- **Verified no exceptions swallowed:** every internal step (`FastAPIInstrumentor`, `HTTPXClientInstrumentor`, `SQLAlchemyInstrumentor`) is wrapped in its own `try/except ImportError` (graceful, expected) separately from a broader `except Exception` (logged as a warning, not silently discarded) — confirmed by reading the code path and by the absence of any warning-level log line in a clean run.

## 2. TracerProvider — executed and verified

Ran `/tmp/otel_validate.py` (standalone script, output captured in full):
```
[PASS] 2a. A provider is registered globally
[PASS] 2b. The registered provider is a real SDK TracerProvider, not the no-op default   type=TracerProvider
[PASS] 2c. Provider contains at least one SpanProcessor   count=1
[PASS] 2d. Exactly one TracerProvider is registered process-wide   (get_tracer_provider() returns the same object on repeated calls)
```
Inspected `provider._active_span_processor._span_processors` directly (not inferred) to count registered processors.

## 3. Exporter detection — executed and verified

```
[PASS] 3. Active exporter(s) identified   exporters=['ConsoleSpanExporter']
[PASS] 3b. OTLP not configured/unavailable -> ConsoleSpanExporter must be active (this run)
    otlp_endpoint_set=False otlp_pkg_available=True exporters=['ConsoleSpanExporter']
```
Note `otlp_pkg_available=True`: the OTLP gRPC exporter package (`opentelemetry-exporter-otlp-proto-grpc`) **is installed** in this environment (added as a real dependency this session, not left as a gap) -- the code correctly chose the console exporter anyway because no `GOV_OTEL_EXPORTER_OTLP_ENDPOINT` was set, which is the correct behavior: package availability and configured endpoint are two independent conditions, both checked.

**OTLP path was not separately live-tested** because no OTLP collector is reachable in this sandbox (would need Docker or a real network endpoint). The code path that selects `OTLPSpanExporter` when both conditions are true was verified by direct code inspection and the `import` succeeding, not by an actual OTLP export over the wire.

## 4. Manual nested spans, attributes, exception recording, flush — executed and verified

Same script, full raw span JSON captured (see prior turn's tool output for the complete dump). Confirmed via direct inspection of the exported JSON:
```
[PASS] 4a. Child span has a different span_id than parent
[PASS] 4b. Child span's parent context matches the parent span's id
[PASS] 4c. Exception recorded on span without crashing the script
[PASS] 4d. provider.force_flush() completed and returned True
```
The exported `parent-operation` span's JSON shows `"status_code": "ERROR"` and an `"events"` array containing a real `exception` event with `exception.type`, `exception.message`, and a full `exception.stacktrace` -- confirming `record_exception()` genuinely captures a real Python traceback, not a placeholder.

**11/11 checks passed** in this script.

## 5. Automatic instrumentation — executed and verified with real span names

Ran `/tmp/otel_live_instrumentation.py`: booted the real app, issued real HTTP requests (`GET /health`, `GET /ready`, `POST /v1/documents`, `GET /v1/documents/search`), captured the console-exported spans from the process's stdout at shutdown.

**SQLAlchemy spans emitted (real DB operations):** `connect`, `PRAGMA ...`, `CREATE ...`, `SELECT ...`, `INSERT ...`

**FastAPI spans emitted (real routes):** `GET /health`, `GET /ready`, `POST /v1/documents`, `GET /v1/documents/search`

**httpx spans emitted (real outbound calls):** `GET /health http send` (JWKS-style calls use this client), and -- notably -- a `PUT` span and a `POST` span **each with a recorded `exception` event**, corresponding to `search.py`'s attempt to reach OpenSearch at the (deliberately unreachable, real) configured URL before falling back to the database. This is strong evidence the instrumentation captures real failure paths, not just happy-path calls.

This is the same evidence base used to close out `FINAL_VALIDATION_REPORT.md`'s prior finding that "OpenTelemetry packages were declared but never used" -- they are now genuinely wired in and independently confirmed to emit spans for all three requested categories (FastAPI, HTTP clients, database access).

## 6. Shutdown flush — a real bug found and fixed this session

**First attempt failed:** the initial live-instrumentation run captured **zero spans**, despite the app clearly serving requests. Root cause, found by direct log inspection: `BatchSpanProcessor` batches asynchronously and nothing in the app ever called `provider.shutdown()` / `force_flush()` on process exit, so buffered spans were silently lost on graceful shutdown.

**Fix:** added an explicit flush step to the FastAPI `lifespan` context manager's teardown (after `yield`), calling `trace.get_tracer_provider().shutdown()` (which internally flushes each processor before shutting it down), wrapped in its own try/except so a tracing shutdown failure can never block the app's own shutdown.

**Re-verified after the fix:** the same live-instrumentation run now captures real spans (see section 5) -- confirming the fix actually closes the gap, not just that the code compiles.

## 7. A second real bug found and fixed: pytest / console-exporter race

Running the full `pytest` suite after wiring up tracing produced (despite 50/50 tests still passing):
```
Exception while exporting Span.
...
ValueError: I/O operation on closed file.
```
**Root cause:** `tests/conftest.py` sets `GOV_ENVIRONMENT=development` by default (needed for other test conveniences), which activated the `ConsoleSpanExporter` fallback path during the test suite. OpenTelemetry's `BatchSpanProcessor` runs a background export thread that outlives individual test boundaries; pytest's stdout capture mechanism closes/reopens file objects between tests, and the background thread's write to a now-closed file object raised.

**Fix:** added an explicit `GOV_OTEL_TRACING_ENABLED` setting (default `true`), set to `false` in `conftest.py`. Re-ran the full suite: clean, no export errors, no change to pass/fail counts (50/50 both before discovering the issue and after the fix -- the bug did not fail any test, but it was real log pollution and a latent resource-leak risk in CI).

**Both directions of the toggle were verified, not just the default:**
- `GOV_OTEL_TRACING_ENABLED=false` -> `isinstance(trace.get_tracer_provider(), TracerProvider)` is `False` (confirmed no-op provider is used, tracing genuinely skipped).
- `GOV_OTEL_TRACING_ENABLED=true` (or unset) -> same 11/11 validation script passes as before.

## Metrics endpoint

`GET /metrics` (Prometheus exposition format) was already implemented prior to this session; re-confirmed reachable via `curl` during this session's live tests (`200`, Prometheus text format). `observability/prometheus.yml` already targets it correctly (`metrics_path: /metrics`, `targets: ["api:8080"]`).

## Structured logging

**Not implemented this session.** Current logging is Python's standard `logging` module with default formatting (plain text, not JSON). This was noticed as a side effect of debugging the OTel log-visibility issue (default log level is `WARNING`, and there's no JSON formatter or log-shipping configuration). Flagged as a real, separate gap from tracing -- not fixed this session since it's a distinct piece of work (would need e.g. `structlog` or a JSON `logging.Formatter`, plus a decision on where structured logs should go, e.g. Loki, which is already provisioned in `docker-compose.production.yml` but has no shipping configured).

## Health/readiness/liveness endpoints

Already covered and verified in the prior session's chaos-testing work: `/health` (liveness, no dependency checks) and `/ready` (readiness, real DB connectivity check, verified to flip to `503` during an actual Postgres outage and recover automatically). Not re-tested this session since no code in that path changed.

## Grafana dashboards

**Not generated.** No dashboard JSON exists in the repo. `docker-compose.production.yml` provisions a Grafana container but with no pre-loaded dashboards or datasource configuration. This is a real, undone piece of work, not something to claim as complete.
