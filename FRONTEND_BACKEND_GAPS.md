# FRONTEND_BACKEND_GAPS.md

This document lists every capability the GoAnalyze frontend needs but the
backend (as described by `/openapi_export.json`) does not currently expose.
Every gap below was confirmed by inspecting the real OpenAPI export — none
are assumptions. Nowhere does the frontend fabricate data to paper over
these gaps; instead it shows an explicit "Backend gap" notice.

The 13 endpoints that **do** exist and are used by the frontend:

```
GET  /health
GET  /ready
GET  /metrics
POST /v1/documents
POST /v1/setup
POST /v1/documents/{document_id}/process
POST /v1/rag/answer
POST /v1/environmental-reviews
POST /v1/cases/{case_id}/assign
GET  /v1/audit
GET  /v1/documents/search
PUT  /v1/documents/{document_id}/content
GET  /v1/documents/{document_id}/download
```

---

## Gap 1 — No document listing endpoint

- **Missing endpoint:** `GET /v1/documents`
- **Affected page(s):** `/documents`, `/dashboard` (recent documents)
- **Data needed:** A paginated list of all documents visible to the current
  tenant/user, independent of any search query.
- **Why it matters:** `GET /v1/documents/search` is a *search* endpoint —
  it requires a query and is scored/ranked by relevance. Using an empty
  query as a stand-in for "list everything" works today (the backend
  falls back gracefully), but it's a workaround, not a real listing
  endpoint, and its ordering/pagination semantics aren't guaranteed to
  stay list-like.
- **Current workaround:** The frontend calls `GET /v1/documents/search`
  with `q=""` and treats the result as a listing. Every document seen
  this way is cached client-side (`lib/documentCache.ts`) to partially
  cover Gap 2.
- **Proposed endpoint:** `GET /v1/documents?page=&page_size=&classification=&content_type=&case_id=`
  returning the same `DocumentRecord[]` shape as ingestion, ordered by
  `created_at desc`.
- **Priority:** High — this is the foundation of the Documents page.

---

## Gap 2 — No single-document fetch endpoint

- **Missing endpoint:** `GET /v1/documents/{document_id}`
- **Affected page(s):** `/documents/[document_id]`, `/analysis/[document_id]`
- **Data needed:** Full metadata for one document by id (filename,
  content_type, classification, tenant, case, version, sha256,
  created_at, metadata).
- **Why it matters:** A document detail page is meaningless without being
  able to fetch that document's own record. Right now, a deep link to a
  document the user hasn't already seen via search/upload in this browser
  session cannot show any metadata at all.
- **Current workaround:** `lib/documentCache.ts` — a sessionStorage cache
  populated from `POST /v1/documents` (ingest) responses and
  `GET /v1/documents/search` results, keyed by document id. If a document
  id isn't in the cache, the page says so explicitly ("Backend gap — no
  GET /v1/documents/{id} endpoint...") instead of showing blank or
  invented fields. Actions that only need the id (download, process) still
  work regardless of cache state.
- **Proposed endpoint:** `GET /v1/documents/{document_id}` returning a
  `DocumentRecord`.
- **Priority:** High — this is a real, user-visible limitation (any
  bookmarked or shared document link that wasn't reached via search will
  show incomplete metadata).

---

## Gap 3 — No case listing endpoint

- **Missing endpoint:** `GET /v1/cases`
- **Affected page(s):** `/cases`
- **Data needed:** A list of cases (id, status, assignee, linked
  documents, created date) visible to the current user/tenant.
- **Why it matters:** There's no way to browse or discover case ids in the
  application today.
- **Current workaround:** The `/cases` page is an "open by ID" form —
  the user must already know the case id (e.g. from an environmental
  review submission or an external workflow). No fake case list is
  rendered.
- **Proposed endpoint:** `GET /v1/cases?page=&page_size=&status=&assignee=`
- **Priority:** High — Cases is currently unusable as a discovery surface,
  only as a direct-action surface.

---

## Gap 4 — No single-case fetch endpoint

- **Missing endpoint:** `GET /v1/cases/{case_id}`
- **Affected page(s):** `/cases/[case_id]`
- **Data needed:** Case status, history, linked documents, current
  assignee, notes.
- **Why it matters:** The case detail page can currently only perform the
  one write action the backend supports (`assign`); it cannot show
  anything about the case's current state.
- **Current workaround:** The page is a pure "assign this case" action
  panel with an explicit gap notice; no case detail is invented.
- **Proposed endpoint:** `GET /v1/cases/{case_id}`
- **Priority:** High — needed to make Cases a real work surface rather
  than a one-shot action form.

---

## Gap 5 — No aggregate processing-status endpoint

- **Missing endpoint:** e.g. `GET /v1/documents/processing-status`
- **Affected page(s):** `/dashboard` (Processing Status panel)
- **Data needed:** Counts of documents pending / processing / completed /
  failed, across the tenant.
- **Why it matters:** `POST /v1/documents/{id}/process` is synchronous and
  per-document; there is no queue or aggregate view to report from.
- **Current workaround:** The dashboard panel states the gap plainly and
  links to where per-document processing can be triggered.
- **Proposed endpoint:** `GET /v1/documents/processing-status` returning
  per-stage counts.
- **Priority:** Medium — nice-to-have operational visibility, not
  blocking core workflows.

---

## Gap 6 — No aggregate risk-analytics endpoint

- **Missing endpoint:** e.g. `GET /v1/analytics/risk-summary`
- **Affected page(s):** `/dashboard` (Risk Overview panel)
- **Data needed:** Portfolio-wide risk distribution (counts of
  low/medium/high risk documents, trend over time).
- **Why it matters:** `risk_score` only exists per-document, inside a
  `POST /v1/documents/{id}/process` response — there's nothing to
  aggregate from.
- **Current workaround:** The dashboard panel states the gap and points
  to per-document risk scores on the Analysis page.
- **Proposed endpoint:** `GET /v1/analytics/risk-summary`
- **Priority:** Medium.

---

## Gap 7 — No pre-signed upload / object-storage handoff endpoint

- **Missing endpoint:** e.g. `POST /v1/documents/upload-url`
- **Affected page(s):** `/documents/upload`
- **Data needed:** A backend-issued object storage key/URL so the
  frontend never has to construct `object_uri` itself.
- **Why it matters:** `DocumentIngestRequest.object_uri` is a required
  field, but the frontend has no direct MinIO/S3 client and no endpoint
  hands it a real object key before ingestion. Today the frontend sends a
  provisional, clearly-marked placeholder URI
  (`pending://{tenant}/{sha256}/{filename}`) and relies on the subsequent
  `PUT /v1/documents/{id}/content` call to actually place the bytes.
  This works end-to-end but means `object_uri` in the ingested record
  doesn't reflect real object storage placement until/unless the backend
  rewrites it during the content PUT.
- **Current workaround:** Provisional client-generated URI, clearly
  commented in `components/documents/DocumentUpload.tsx` and disclosed to
  the user on the upload page.
- **Proposed endpoint:** `POST /v1/documents/upload-url` returning a
  pre-signed URL or object key, OR have `POST /v1/documents` itself
  allocate `object_uri` server-side and return it (making the field
  response-only, not request-required).
- **Priority:** Medium-High — functionally works today, but is the least
  clean part of the integration and worth tightening.

---

## Gap 8 — Keycloak realm/client not provisioned

- **Missing:** A `goanalyze` realm (or equivalent) in the Keycloak
  instance at `http://localhost:8081`, with a public OIDC client (e.g.
  `goanalyze-frontend`) configured for Authorization Code + PKCE, valid
  redirect URI `http://localhost:3000/login/callback` (and equivalents
  per environment), and at least one test user/role mapping.
- **Affected page(s):** `/login`, `/login/callback`, every protected page
  (all pages behind `AppShell`'s auth guard).
- **Why it matters:** This isn't an HTTP API gap but a deployment
  configuration gap: the frontend's OIDC flow (`lib/auth.ts`) is fully
  real (Authorization Code + PKCE, no client secret, no fake auth), but it
  has nothing to authenticate against until this is provisioned.
- **Current workaround:** None applicable — this must be provisioned in
  Keycloak/infra, not worked around in the frontend. `NEXT_PUBLIC_KEYCLOAK_ISSUER`
  and `NEXT_PUBLIC_KEYCLOAK_CLIENT_ID` are already wired to be configurable
  via environment variables once the realm/client exist.
- **Priority:** Critical for any real login to succeed — see
  FRONTEND_IMPLEMENTATION_REPORT.md, "Authentication" section, for exact
  provisioning steps.

---

## Summary table

| # | Gap | Priority | Pages affected |
|---|-----|----------|-----------------|
| 1 | `GET /v1/documents` | High | Documents, Dashboard |
| 2 | `GET /v1/documents/{id}` | High | Document detail, Analysis |
| 3 | `GET /v1/cases` | High | Cases |
| 4 | `GET /v1/cases/{id}` | High | Case detail |
| 5 | Aggregate processing status | Medium | Dashboard |
| 6 | Aggregate risk analytics | Medium | Dashboard |
| 7 | Pre-signed upload URL | Medium-High | Upload |
| 8 | Keycloak realm/client provisioning | Critical (infra) | Login, all protected pages |
