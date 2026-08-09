# FINAL_SECURITY_REPORT.md

**Date:** 2026-08-03. Attacks below were executed against a live server running against real PostgreSQL, real Redis, and authenticated with real Keycloak-issued JWTs (not synthetic tokens) unless noted otherwise.

## Attack results

| Attack | Result | Evidence |
|---|---|---|
| JWT forgery (tampered real token signature) | Blocked | `401` |
| JWT forgery (historical `tenant:x:role` string exploit) | Blocked | `401 malformed_token` (pytest regression test) |
| Expired JWT | Blocked | `401 token_expired` (pytest) |
| Wrong audience | Blocked | `401` (pytest) |
| Wrong issuer | Blocked | `401` (pytest) |
| Privilege escalation (reader role calling case-manager-only endpoint) | Blocked | `403`, real Keycloak token |
| Broken RBAC/ABAC | Not found | role + classification + purpose checks consistently enforced across 50 pytest tests + this session's live checks |
| Tenant escape (real token holder targeting another tenant) | Blocked | `403 tenant_mismatch`, real Keycloak token |
| SQL Injection | Not exploitable | `'; DROP TABLE documents; --'` as a filename stored as inert text via real Postgres; table verified intact afterward |
| XSS | Low risk | React auto-escapes; API is JSON-only |
| SSRF | Not exploitable | No user-supplied URL is fetched server-side |
| CSRF | Not applicable | Stateless bearer-token auth, no cookies |
| Path Traversal | Blocked | traversal-shaped document ID returns `404`, not 500 or file disclosure; storage keys are always server-derived, never client-supplied |
| Header Injection (CRLF in filename to Content-Disposition) | Blocked | tested with a real Keycloak-authenticated upload/download round trip; no injected header appeared in the response |
| File Upload attacks (oversized) | Blocked | `413 upload_too_large` above a configured cap (pytest, monkeypatched cap for speed) |
| Large file DOS | Handled | 5 MB round-trip tested successfully in pytest; upload cap prevents unbounded memory use |
| Race conditions | Not specifically tested | no concurrent-write race test was run against real Postgres this session; SQLAlchemy's session-per-request model and Postgres's MVCC provide baseline protection, but this is not the same as a targeted concurrency test |
| Rate-limit bypass | Blocked | tested against real Redis: 15 rapid requests with a 10/min per-user cap correctly triggered `429` every time past the threshold |
| Authentication bypass | Blocked | header-spoofing (`x-tenant-id`/`x-roles` with no bearer token) returns `401` when the dev-auth bypass is disabled, tested against the real stack |
| Authorization bypass | Not found | see RBAC/ABAC row |
| Replay attacks | Not specifically tested | JWTs are stateless bearer tokens with short expiry (Keycloak default lifespan observed: 300s for `goanalyze` realm); no JTI-based replay prevention exists at the app layer; a captured, still-valid token could be reused within its lifetime. This is standard OAuth2 bearer-token behavior, not a defect, but worth noting explicitly since it wasn't a targeted test |
| Session fixation | Not applicable | no server-side session state; stateless JWT |
| Clickjacking | Blocked | `X-Frame-Options: DENY` verified present on live responses |
| Open Redirect | Not found | the app has no redirect endpoints; the frontend's only redirect (`/setup` to `/`) is a fixed, hardcoded client-side path, not derived from user input |
| Sensitive data exposure | Partial | see "New finding" below |
| Broken CORS | Not found | untrusted origin not reflected in `Access-Control-Allow-Origin`, tested live |
| Broken CSP | Not found | `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` present and verified live |
| Weak secrets | Fixed (prior session) | no hardcoded secrets; production boot fails without a real audit secret |
| Dependency vulnerabilities | 1 open, documented below | `npm audit`: 0. `pip-audit`: 1 (ecdsa, see below) |

## New finding this session: `ecdsa` dependency vulnerability

`pip-audit` reported `ecdsa==0.19.2` (a transitive dependency of `python-jose`, used for JWT verification) has a known vulnerability, `PYSEC-2026-1325`. Checked for a fix: **0.19.2 is already the latest available release** -- there is no newer version to upgrade to. This is consistent with `ecdsa`'s maintainers' long-standing public position that pure-Python ECDSA implementations cannot practically guarantee constant-time operations against side-channel/timing attacks, and that they do not intend to "fix" this class of issue in the traditional sense.

**Applicability to GoAnalyze:** our JWT verification code (`gov_platform/security.py`) only ever requests `algorithms=[algorithm]` where `algorithm` comes from the JWKS key's own `alg` field, and every real Keycloak JWKS key observed in this engagement (both the local test JWKS and the real Keycloak-issued one) uses `RS256` (RSA), not any `ES*` (ECDSA) algorithm. `ecdsa`'s vulnerable code path is for elliptic-curve operations specifically -- it is not exercised by this application's actual JWT verification flow, though it remains present as an installed dependency.

**Recommendation, not fixed this session:** either (a) accept this as a documented, low-risk finding since the vulnerable code path isn't reachable, or (b) migrate off `python-jose` (unmaintained upstream, per its own repository status) to `PyJWT` with the `cryptography` backend, which does not depend on the pure-Python `ecdsa` package at all. This is a reasonable follow-up but was not done this session to avoid an untested last-minute dependency swap in the single most security-critical code path in this codebase.

## Real-Redis rate limiting -- confirmed with real infrastructure this session

Previously (prior sessions) only tested against `fakeredis`. This session, ran the same scenario against a genuinely running `redis-server`: 15 rapid authenticated requests against a 10/minute per-user cap. Result: requests past the threshold all returned `429`, and `redis-cli` confirmed real `ratelimit:*` keys existed with real TTLs. This closes the gap between "rate limiting logic is correct" (proven earlier via fakeredis) and "rate limiting works against real Redis" (proven this session).

## SBOM generation — executed with real tooling

- **Backend:** `cyclonedx-py environment .venv --output-format json --output-file sbom-backend.cdx.json` — succeeded. Real output: CycloneDX 1.6 format, 127 components, saved to `sbom-backend.cdx.json`.
- **Frontend:** `npx @cyclonedx/cyclonedx-npm --output-file sbom-frontend.cdx.json` — succeeded. Real output: CycloneDX 1.6 format, 333 components, saved to `sbom-frontend.cdx.json`.

## Image vulnerability scanning — real binary obtained, blocked by network policy

Downloaded the real `trivy` binary (v0.73.0) from its GitHub release (`release-assets.githubusercontent.com` is whitelisted). Running `trivy fs --scanners vuln .` failed with a **confirmed, direct 403**: its vulnerability database is hosted at `mirror.gcr.io`, which is outside this sandbox's network allowlist. This is a genuine, verified environment limitation, not an assumed one — the binary itself works (`trivy --version` succeeded); only its DB fetch is blocked.

## Unchanged from prior sessions

- No penetration test by a human security researcher has been performed.
- No WAF/reverse-proxy-level protections evaluated (out of scope: application code only).
- MFA / Keycloak realm hardening beyond what was configured this session (a working realm with 4 users) is not in place -- this was a functional-test realm, not a hardened production configuration.

## Independent audit follow-up (subprocess/deserialization/bandit re-scan)

Re-ran `bandit -r gov_platform`: **0 issues** (the one prior finding remains correctly suppressed via a documented `# nosec` justification, confirmed still present: "1 potential issue skipped due to specifically being disabled"). Grepped the entire application for unsafe `subprocess`, `eval()`, `pickle.*`, and `yaml.load()` usage: **zero matches** in `gov_platform/*.py`. No new security findings from this pass -- the audit-chain-lock and connection-pool-sizing fixes documented in `BUGS_FIXED.md`/`FINAL_DATABASE_AUDIT.md` are reliability/correctness fixes, not security fixes, and are not double-counted here.
