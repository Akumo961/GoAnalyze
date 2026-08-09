# FEATURE_COMPLETION_REPORT.md

**Date:** 2026-08-02
**Scope:** Implement the three features `FINAL_VALIDATION_REPORT.md` identified as missing: Document Search API, Document Download API, and Redis-backed rate limiting.

## Sandbox constraints (unchanged from prior reports)

No Docker daemon, no live PostgreSQL/OpenSearch/MinIO/Redis/Keycloak.
Every feature below was built with a **real integration path** (real
OpenSearch REST API calls via `httpx`, the real `minio` SDK, a real
`redis.asyncio` client) **plus an automatic fallback** so the API keeps
working without that infrastructure -- and both paths are proven with
evidence, not assumed.

---

## 1. Document Search API — ✔ Implemented

**Endpoint:** `GET /v1/documents/search?q=&page=&page_size=&classification=&content_type=`

- **Full-text search:** `multi_match` query against `filename` and
  `metadata.*` fields (OpenSearch backend).
- **OpenSearch integration:** real REST calls (`PUT /{index}/_doc/{id}`
  on ingest, `POST /{index}/_search` on query) via `httpx.AsyncClient`
  against `settings.opensearch_url` -- not a stub.
- **Tenant isolation:** a `{"term": {"tenant_id": ...}}` clause is always
  injected server-side into the query and can never be overridden by the
  caller; verified live (a real OpenSearch-shaped request was captured via
  monkeypatched HTTP and asserted to contain this clause) and at the API
  level (tenant B's search never returns tenant A's documents).
- **Pagination:** `page`/`page_size` (1-100, validated, `422` on
  out-of-range), verified to return disjoint result sets across pages.
- **Filters:** `classification`, `content_type`.
- **Ranking:** OpenSearch's native relevance score (`_score`) is returned
  per hit, plus filename highlighting.
- **Fallback:** if OpenSearch is unreachable, automatically falls back to
  a tenant-scoped `ILIKE` search against PostgreSQL/SQLite
  (`DocumentRepository.search`), so the endpoint never hard-fails during a
  search-cluster outage. The response body's `"backend"` field
  (`"opensearch"` vs `"database_fallback"`) makes which path served the
  request observable.

**Design note:** since there is no live OpenSearch cluster to test
against in this sandbox, the OpenSearch code path is proven two ways: (1)
a unit test that monkeypatches the actual HTTP call and asserts the
request/response shape is correct, and (2) a manual run pointing
`GOV_OPENSEARCH_URL` at a real-but-unreachable address, confirming the
code attempts the real connection and then correctly falls back rather
than crashing. The fallback path is exercised end-to-end by every other
search test, since no OpenSearch is reachable in the test environment by
default.

---

## 2. Document Download API — ✔ Implemented

**Endpoints:**
- `PUT /v1/documents/{document_id}/content` -- upload the original file bytes
- `GET /v1/documents/{document_id}/download` -- stream them back

This closes a gap `FINAL_VALIDATION_REPORT.md` flagged implicitly: the
original ingest endpoint only ever accepted file *metadata*
(`object_uri` as a string), with no way to actually get bytes into or out
of storage. The upload endpoint was added specifically to make download
testable and usable end-to-end.

- **MinIO/S3 backend:** `MinioObjectStorage` uses the official `minio` SDK
  against `settings.minio_endpoint`/`minio_bucket` (works unchanged
  against real MinIO or AWS S3).
- **Bucket auto-creation:** `_ensure_bucket_sync` calls `bucket_exists` /
  `make_bucket` before every write.
- **Streaming download:** response is a `StreamingResponse`.
- **Correct MIME types:** `media_type` is set from the document record's
  stored `content_type`; `Content-Disposition: attachment; filename="..."`
  is set from the stored filename.
- **Permission checks:** both endpoints run the same ABAC check as the
  rest of the API (`evaluate_abac`) -- tenant mismatch -> `403`,
  Protected-B without the right role -> `403`.
- **Audit logging:** both `document.content_uploaded` and
  `document.downloaded` are appended to the hash-chained audit log.
- **Integrity hashing:** upload recomputes SHA-256 server-side over the
  received bytes and rejects (`422 sha256_mismatch`) if it doesn't match
  the hash recorded at ingest time -- verified with a real tampered-bytes
  test.
- **Storage-key security decision:** the object storage key is always
  derived server-side as `f"{tenant_id}/{document_id}"` -- **never** from
  the client-supplied `object_uri` field -- closing off any path-traversal
  or cross-tenant-overwrite surface that trusting a client-supplied path
  would otherwise open. Covered by a regression test.
- **Fallback:** `InMemoryObjectStorage` is used automatically if MinIO is
  unreachable, proven live by pointing `GOV_MINIO_ENDPOINT` at a
  real-but-unreachable address and completing a full upload/download
  round-trip anyway.
- **Large files:** tested with a 5 MB payload round-trip.
- **Missing objects:** downloading before uploading -> `404
  document_content_not_uploaded`; downloading a nonexistent document ID ->
  `404 document_not_found`.

**Not implemented / out of scope:** a browser-facing upload/download UI.
The existing frontend has no document-list or file-management screen to
wire this into (it's a setup wizard plus a static dashboard shell) --
building that UI is a new feature, not closing a previously-identified
gap, so it was left out per the "do not add new features" framing of this
pass. The backend APIs are complete, tested, and ready for a frontend to
consume.

---

## 3. API Rate Limiting — ✔ Implemented

**Mechanism:** fixed-window counters (`INCR` + `EXPIRE`) in Redis via
`redis.asyncio`, configurable through `Settings`
(`rate_limit_enabled`, `rate_limit_per_ip_per_minute`,
`rate_limit_per_user_per_minute`, `rate_limit_per_tenant_per_minute`).

- **Per-IP:** ASGI middleware, applied to every request except
  `/health`/`/metrics`, keyed by `request.client.host`. Runs *before*
  authentication, so it also protects login/auth endpoints against
  credential-stuffing.
- **Per-user / per-tenant:** enforced inside `get_current_context`
  immediately after a JWT is verified, keyed by the verified `sub` and
  `tenant_id` claims (never client-supplied headers) -- so these limits
  can't be evaded by lying about identity.
- **Configurable:** all three thresholds and the enable/disable flag are
  environment-variable-driven (`GOV_RATE_LIMIT_*`).
- **429 responses:** `HTTPException(429, "rate_limit_exceeded")`, with a
  `Retry-After` header derived from the actual Redis key TTL.
- **Window reset:** verified that clearing the counter allows requests
  through again (simulating window expiry).
- **Fail-open on Redis outage:** if Redis is unreachable, the limiter logs
  a warning and allows the request through rather than taking the whole
  API down -- verified live by pointing `GOV_REDIS_URL` at a
  real-but-unreachable address and confirming both `/health` and an
  authenticated request still succeed.
- **Bounded memory:** every counter key carries a Redis `EXPIRE`, so keys
  don't accumulate indefinitely (verified via TTL assertion).

**Design note on burst/1000-user testing:** true burst-traffic and
sustained 1000-concurrent-user testing of the rate limiter specifically
would need a real Redis instance under real network latency to produce
meaningful numbers; what's proven here is *correctness* (limits trigger,
reset, and fail open correctly) via `fakeredis`, not production-scale
capacity. The prior session's general concurrency test
(`FINAL_VALIDATION_REPORT.md`, Phase 9) already covered raw
throughput/latency at 100/500/1000 concurrent requests against the app as
a whole; that result stands and wasn't re-run here since it wasn't
specific to rate limiting.

---

## OpenAPI — ✔ Updated and validated

`openapi_export.json` regenerated from `app.openapi()`: **12 paths**, up
from 9 -- includes `GET /v1/documents/search`,
`PUT /v1/documents/{document_id}/content`, and
`GET /v1/documents/{document_id}/download`. Structurally validated: valid
OpenAPI 3.1.0, every operation has a `responses` object.

---

## Integration tests — ✔ 24 new tests added (47 total, up from 23)

| File | Tests | Covers |
|---|---|---|
| `tests/test_search.py` | 7 | auth requirement, DB fallback, tenant isolation, pagination, classification filter, invalid-pagination `422`s, real OpenSearch request/response shape via monkeypatched HTTP |
| `tests/test_download.py` | 10 | upload/download round-trip, SHA-256 integrity rejection, missing-object `404`s, cross-tenant `403`s (both directions), auth requirement, empty-body rejection, storage-key security regression, 5 MB streaming |
| `tests/test_rate_limit.py` | 7 | per-IP blocking, `Retry-After` header, health-endpoint exemption, window reset, per-user limit independence, Redis-unreachable fail-open, bounded-key TTL |

All 47 tests pass. `ruff check` passes with zero findings. `npm run
build` and `npm run lint` both pass with zero findings.

---

## Commands executed (all real, output shown above in this session)

```
pip install -e ".[dev]"          # picked up minio, opensearch-py* (unused, kept), fakeredis
python -m pytest tests/ -v       # 47 passed
ruff check gov_platform tests migrations --fix   # All checks passed!
alembic upgrade head / autogenerate diff check   # confirmed zero schema drift from these features
python -c "...app.openapi()..." # regenerated openapi_export.json, 12 paths
npm run build                    # ✓ Compiled successfully
npm run lint                     # zero findings
python3 /tmp/manual_verify_features.py   # 9/9 live manual checks passed
```

\* `opensearch-py` was already a listed dependency but ended up unused --
its async client requires `aiohttp`, which isn't installed, so the
OpenSearch integration was built directly on `httpx` instead (consistent
with how the rest of the codebase talks to external HTTP services, e.g.
JWKS). Left the dependency declared rather than editing an unrelated
pyproject line as a drive-by change; worth removing in a follow-up
cleanup.

## What remains unverifiable in this sandbox

- Real OpenSearch cluster behavior (index creation, real relevance scoring
  at scale, real highlighting).
- Real MinIO bucket lifecycle, multipart/very-large-file uploads, S3
  presigned URLs.
- Real Redis behavior under production concurrency/latency.
- All of the above require Docker or real infrastructure, which is not
  available here -- consistent with every prior report in this
  engagement.
