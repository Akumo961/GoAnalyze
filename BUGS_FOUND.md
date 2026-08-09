# BUGS_FOUND.md

All items below were reproduced before being fixed, and re-verified after.
Severity follows: **Critical** (exploitable data breach / total build failure),
**High** (major security or functional break), **Medium**, **Low**.

---

### 1. [CRITICAL — Security] Authentication was completely forgeable
**Where:** `gov_platform/security.py::_decode_development_token` (removed)
**Details:** Any bearer token of the form `tenant:<tenant_id>:<roles>` was
accepted with **zero signature verification** — no check against Keycloak,
no expiry, nothing. A request with header
`Authorization: Bearer tenant:ministry-b:platform-admin,protected-b-reader,tenant-admin`
granted full platform-admin access to any tenant, including reading
Protected-B classified documents.
**Reproduced:** live `curl` against the running server returned `200` and
the created document record.
**Fix:** Replaced with real Keycloak JWKS-based JWT verification
(signature, issuer, audience, expiration). Confirmed the same forged token
now returns `401 {"detail":"malformed_token"}`.
**Regression test:** `tests/test_auth.py::test_legacy_colon_format_dev_token_is_no_longer_valid`, `tests/test_tenant_isolation.py::test_documents_endpoint_rejects_forged_legacy_token`

---

### 2. [CRITICAL — Security] Unauthenticated header-based privilege escalation
**Where:** `gov_platform/security.py::get_current_context` (original)
**Details:** When no bearer token was supplied at all, the API trusted
client-supplied `x-tenant-id` / `x-roles` headers outright — no
authentication of any kind. Any anonymous client could set
`x-roles: platform-admin` and act as a superuser for any tenant.
**Reproduced:** live `curl` with no `Authorization` header, only spoofed
headers, returned `200`.
**Fix:** This path now requires **both** `GOV_ENVIRONMENT=development` and
an explicit `GOV_ALLOW_INSECURE_DEV_AUTH=true`. Neither is set by default.
A `pydantic` validator additionally hard-fails app startup if this flag is
ever combined with `environment=production`.
**Reproduced fixed:** same request now returns `401 {"detail":"missing_or_invalid_bearer_token"}` even with `GOV_ENVIRONMENT=development` and the flag unset.

---

### 3. [CRITICAL — Build] `pyproject.toml` had no `[build-system]` table
**Where:** `pyproject.toml`
**Details:** `pip install -e .` failed outright — setuptools' flat-layout
auto-discovery found `helm/`, `frontend/`, `terraform/`, `observability/` as
false top-level Python packages and refused to build.
**Fix:** Added an explicit `[build-system]` + `[tool.setuptools] packages = ["gov_platform"]`.
**Verified:** `pip install -e ".[dev]"` now succeeds cleanly.

---

### 4. [CRITICAL — Build] Frontend setup wizard file was truncated
**Where:** `frontend/app/setup/page.tsx`
**Details:** The file was cut off mid-JSX-attribute inside the "AI provider"
step. The entire "notifications" step, "review" step, navigation buttons,
closing tags, and a `Field` component (used ~15 times, never defined
anywhere in the file) were all missing. `npm run build` failed with a
parser error.
**Fix:** Rewrote the missing ~150 lines: completed the AI step, added the
notifications and review steps, added navigation, defined the `Field`
component, and removed a stray leftover `"` character.
**Verified:** `npm run build` completes successfully; `Route (app)` output
lists `/`, `/_not-found`, `/setup`.

---

### 5. [HIGH — Security] `/v1/rag/answer` had no authentication or tenant check
**Where:** `gov_platform/main.py::rag_answer` (original)
**Details:** The endpoint took no `context: TenantContext = Depends(...)`
at all — any anonymous caller could invoke it, and any `document_id` could
be cited in the request body with no verification that the caller's tenant
actually owned that document.
**Fix:** Endpoint now requires authentication; every cited `document_id`
is re-fetched from the database and its `tenant_id` compared against the
caller's tenant (or `platform-admin` role), returning `403` on mismatch.
**Verified:** `tests/test_tenant_isolation.py::test_rag_answer_requires_authentication` and `::test_rag_answer_rejects_citation_from_other_tenant` both pass; live cross-tenant curl test returns `403 {"detail":"citation_tenant_mismatch"}`.

---

### 6. [HIGH — Data integrity] No persistence layer at all
**Where:** `gov_platform/main.py` (`documents: dict[UUID, DocumentRecord] = {}`)
**Details:** Despite PostgreSQL being fully provisioned in
`docker-compose.yml` and `sqlalchemy`/`asyncpg` being listed as
dependencies, the API never actually wrote to a database. All ingested
documents, case assignments, and audit events lived in a plain Python dict
and were lost on every restart. There were also **no Alembic migrations
anywhere in the repository**.
**Fix:** Added SQLAlchemy ORM models, an async session/engine layer, a
repository layer, and Alembic migrations. All document, user, case
assignment, and audit-event writes now go through the database.
**Verified:** `alembic upgrade head` / `alembic downgrade base` both run
cleanly against a SQLite smoke-test DB; live server run against SQLite
persisted a document and returned it correctly on a subsequent audit-log
query.

---

### 7. [HIGH — Security] Insecure default audit secret / no production secret validation
**Where:** `gov_platform/config.py`
**Details:** `audit_hash_secret` defaulted to the literal string
`"change-me-through-secrets-manager"` with nothing enforcing that it be
changed. Since this secret is what makes the audit hash chain tamper-evident,
deploying with the default would let anyone who reads the source silently
forge audit history.
**Fix:** Default is unchanged (still used for local dev), but a
`model_validator` now raises at startup if `environment=production` and the
secret is either the known-insecure default or empty.
**Verified:** `Settings(environment="production", audit_hash_secret="change-me-through-secrets-manager")` raises `ValidationError`; a real secret is accepted.

---

### 8. [HIGH — Dependency] High-severity npm vulnerabilities
**Where:** `frontend/package.json` (Next.js 16.2.10)
**Details:** `npm audit` reported 6 vulnerabilities (2 low, 4 high) in
Next.js and its transitive `postcss`/`sharp` dependencies.
**Fix:** Bumped Next.js to `^16.2.12` and added `overrides` pinning
`postcss` and `sharp` to patched versions.
**Verified:** `npm audit` now reports **0 vulnerabilities**; `npm run build` still succeeds.

---

### 9. [MEDIUM — Broken UX] Setup wizard redirected to a nonexistent `/dashboard` route
**Where:** `frontend/app/setup/page.tsx` (two call sites)
**Details:** On completing setup (or on revisiting `/setup` after
completion), the wizard called `router.push("/dashboard")` /
`router.replace("/dashboard")`. No `/dashboard` route exists in the app —
only `/` (which already contains the dashboard UI) and `/setup` do. This
would have 404'd every user immediately after finishing setup.
**Fix:** Both redirects changed to `"/"`.

---

### 10. [MEDIUM — Broken tooling] `next lint` no longer exists in Next.js 16
**Where:** `frontend/package.json` (`"lint": "next lint"`)
**Details:** Next.js 16 removed the `next lint` subcommand entirely; running
it errored with `Invalid project directory provided, no such directory:
.../frontend/lint` (Next interpreted "lint" as a positional directory
argument).
**Fix:** Changed the script to `"lint": "eslint ."`, which uses the
existing flat ESLint config directly.
**Verified:** `npm run lint` now runs and reports real findings instead of erroring.

---

### 11. [LOW — Lint] React hydration-mount anti-pattern flagged by `eslint-plugin-react-hooks`
**Where:** `frontend/app/setup/page.tsx`
**Details:** `setHasMounted(true)` was called in the same effect as a
routing side-effect, tripping `react-hooks/set-state-in-effect`.
**Fix:** Split into two effects; the mount-flag setState is the standard
SSR-hydration idiom and is suppressed with a one-line justified
`eslint-disable-next-line` comment rather than a broader refactor.

---

### 12. [LOW — Lint] Anonymous default export
**Where:** `frontend/eslint.config.mjs`
**Fix:** Named the array before exporting it (`const eslintConfig = [...]; export default eslintConfig;`).

---

## Not a bug, but flagged as a documentation-drift concern
`PRODUCTION_READINESS_REPORT.md` and `PROJECT_COMPLETENESS_REPORT.md`
already existed in the repository prior to this engagement and were largely
accurate about outstanding gaps (they explicitly listed "replace in-memory
stores" and "implement production OIDC JWKS verification" as known
remaining work) — worth noting since it means the project's own docs were
honest about the risk, even though the code hadn't caught up yet.
