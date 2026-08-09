# ROOT_CAUSE_ANALYSIS.md

**Date:** 2026-08-03
**Environment:** Real Keycloak 26.0.7 (downloaded from GitHub releases, running under bundled JDK 21), real PostgreSQL 16.14, real Redis — all genuinely running processes in this sandbox, not mocks.

## Symptom

`POST /realms/goanalyze/protocol/openid-connect/token` with `grant_type=password` consistently returned:
```
400 {"error": "invalid_grant", "error_description": "Account is not fully set up"}
```
for every user in the `goanalyze` realm, regardless of client configuration. The identical grant against the built-in `master` realm succeeded immediately for a brand-new user with no special setup.

## Evidence collected (in order)

1. **Realm authentication flow bindings** — `browserFlow: browser`, `directGrantFlow: direct grant`, both built-in and correctly bound. Direct grant flow executions (`Username Validation` → `Password` → conditional OTP subflow) matched Keycloak's standard default exactly. **Ruled out: flow misconfiguration.**

2. **Client configuration isolation test** — created a second, `publicClient: true` client (`diagnostic-public-client`) mirroring `admin-cli`'s type, with `directAccessGrantsEnabled: true`. Same failure. **Ruled out: confidential-vs-public client type, client auth method.**

3. **User configuration isolation test** — created `minimal_test_user` with the absolute minimum body (`username`, `enabled`, one password credential, nothing else — no email, no attributes, no explicit `requiredActions`). Same failure. Also directly inspected the existing `reviewer` user via `GET /admin/realms/goanalyze/users/{id}` and `.../credentials`: `enabled: true`, `emailVerified: true`, `requiredActions: []`, one properly argon2-hashed password credential present. **Ruled out: any obvious per-user misconfiguration; ruled out missing/broken credential.**

4. **Realm-vs-realm isolation test (the decisive split)** — created a brand-new non-admin user directly in the **built-in `master`** realm and requested a password grant via `admin-cli` (public client, already proven to work for the `admin` user). **Succeeded (200, real token).** This isolated the variable to "realm creation method/realm identity," not client or user config.

5. **Tooling isolation test** — used Keycloak's own official `kcadm.sh` CLI (not raw REST calls) to create a fresh realm (`kcadmtest`), user, and public client from scratch. Same failure. **Ruled out: a subtlety in my hand-written REST JSON payloads; this reproduces via Keycloak's own first-party tooling.**

6. **Cache-vs-persistence test** — fully restarted the Keycloak process (`pkill` + relaunch) to force a cold reload of all realm state from the database, then retested. Same failure, unchanged. **Ruled out: an in-memory realm cache warm-up issue.**

7. **Realm export diff** — exported both `master` and `goanalyze` via `GET /admin/realms/{realm}` and `POST /admin/realms/{realm}/partial-export?exportClients=true&exportGroupsAndRoles=true`, normalized to sorted JSON, and diffed every field. The only differences in the plain realm representation were cosmetic (`displayName`, `accessTokenLifespan`, internal `id`, realm name) — nothing related to authentication. **The decisive finding was in the partial-export's `components` block:**
   - `master`'s `components` included `org.keycloak.userprofile.UserProfileProvider` (a `declarative-user-profile` component with an explicit attribute schema).
   - `goanalyze`'s `components` block **did not have this key at all.**

8. **Confirmed via the documented User Profile API** — `GET /admin/realms/{realm}/users/profile` for `goanalyze` returned a **fallback default schema** (not the same as an explicitly configured one) where `email`, `firstName`, and `lastName` were marked `"required": {"roles": ["user"]}`. The equivalent call for `master` returned its real, persisted schema, where those same fields carry **no** `required` marker. This is the generated default Keycloak serves when no `UserProfileProvider` component is persisted for a realm.

9. **Decisive confirmation test** — created a new user in `goanalyze` with `email`, `firstName`, and `lastName` all populated (no other change). **The password grant succeeded immediately (200, real token).** This is direct, controlled, before/after proof.

## Confirmed root cause

**Realms created via the Keycloak Admin REST API (`POST /admin/realms`) — including via the official `kcadm.sh` CLI, which uses the same endpoint under the hood — do not automatically provision a `UserProfileProvider` component**, unlike the built-in `master` realm, whose component is seeded as part of Keycloak's own bootstrap/migration data at first server startup.

In the absence of a persisted `UserProfileProvider` component, Keycloak's login pipeline falls back to a **compiled-in default declarative user-profile schema** that marks `email`, `firstName`, and `lastName` as required attributes for users with the `user` role. When a user is missing any of these (which is normal for a freshly-created API/test user, and normal for `admin`-created service accounts in general), the direct-grant flow's required-action/profile-completeness resolution step fails — but instead of returning a specific, actionable error (e.g. "missing required user profile attribute: email"), it surfaces the generic, misleading `invalid_grant: "Account is not fully set up"`, which gives no indication that a user-profile schema issue is involved.

A secondary, related finding: **custom user attributes (e.g. `tenant_id`) set via `PUT /admin/realms/{realm}/users/{id}` with `attributes: {...}` are silently dropped** for a realm with no persisted user-profile schema, because the declarative user profile's default `unmanagedAttributePolicy` does not permit unrecognized attributes. This has no error response — the `PUT` returns `204` and simply does not persist the attribute — which is its own minor pitfall worth documenting separately.

## Classification

This is **primarily an Admin REST API / realm-provisioning gap in Keycloak 26.0.7**, not a misuse of the API on our part (reproduced via both raw REST and Keycloak's own `kcadm.sh`) and not an H2-vs-PostgreSQL persistence issue (reproduced identically before touching PostgreSQL, and the restart-to-force-DB-reload test showed the same behavior). Whether Keycloak's own team considers this "working as intended" (i.e., operators are expected to always explicitly configure a User Profile for any realm created via the API) or a genuine gap in default-realm provisioning is a documentation/design question we can't resolve without access to Keycloak's own issue tracker from this sandbox (no network path to it) — but the practical behavior is clearly a footgun: a realm created via the documented, standard `POST /admin/realms` call is left in a state where **no user, including ones that appear fully configured by every other visible signal, can authenticate via password grant** until an operator separately and non-obviously configures `PUT /admin/realms/{realm}/users/profile`.

## Permanent fix applied

For the `goanalyze` realm:
1. `GET /admin/realms/master/users/profile` to obtain a known-working schema.
2. Added an explicit `tenant_id` attribute declaration to that schema (the correct, documented mechanism for a custom claim-source attribute, rather than relying on the unmanaged-attribute fallback).
3. Set `unmanagedAttributePolicy: "ENABLED"` as defense-in-depth for any other incidental custom attributes.
4. `PUT /admin/realms/goanalyze/users/profile` with the corrected schema.
5. Backfilled `email`/`firstName`/`lastName` on the four existing users (Platform Admin, Tenant Admin, Reviewer, Reader) and re-set the `tenant_id` attribute on `reviewer` now that it persists correctly.

**Result, directly verified:** `POST /realms/goanalyze/protocol/openid-connect/token` with `grant_type=password` for user `reviewer` against the real confidential client `goanalyze-api` returned `200` with a real, RS256-signed JWT. Decoded and verified:
- `iss: http://127.0.0.1:8180/realms/goanalyze` ✔ correct issuer
- `aud: account` ✔ present (Keycloak's default audience for direct-grant tokens; the running app was configured with `GOV_KEYCLOAK_AUDIENCE=account` to match)
- `exp` ✔ in the future
- `tenant_id: ministry-a` ✔ present and correct
- `roles: ["case-reviewer", "offline_access", "uma_authorization", "default-roles-goanalyze"]` ✔ includes the assigned role
- Signature verified by fetching the real JWKS from `http://127.0.0.1:8180/realms/goanalyze/protocol/openid-connect/certs` and validating RS256 against it (this is exactly what the running GoAnalyze app itself does, live, on every request — not a separate/simulated check)

**Then executed a real authenticated request against the actual GoAnalyze application** (running against real PostgreSQL, `GOV_ALLOW_INSECURE_DEV_AUTH=false`):
```
POST /v1/documents  Authorization: Bearer <real Keycloak JWT>
-> HTTP 200
{"tenant_id":"ministry-a", ..., "filename":"root_cause_verified.pdf", "id":"6aba227d-...", ...}
```
This is the first point in this entire engagement where GoAnalyze has been exercised with a **fully real, unmocked identity provider** end to end.

## Recommendation for a real deployment

Whoever provisions the `goanalyze` realm in a real Keycloak deployment (via Terraform, a setup script, or the Admin Console UI) must either:
- Explicitly configure the realm's User Profile (`PUT /admin/realms/{realm}/users/profile`) as part of realm provisioning, including declaring any custom claim-source attributes like `tenant_id`, **or**
- Use the Admin Console UI to create the realm (which, based on this investigation, is expected to provision the User Profile component correctly, matching `master`'s behavior — not independently verified here since no browser automation is available in this sandbox), **or**
- Import a full realm JSON export (via `POST /admin/realms/{realm}/partial-import` or the `--import-realm` server flag) that includes an explicit `components` block, rather than creating the realm with a minimal `{"realm": ..., "enabled": true}` body.

This should be added as an explicit step in any infrastructure-as-code / Terraform Keycloak provisioning for this project, since the current `docker-compose.yml`/Helm setup does not configure a realm at all yet (Keycloak is provisioned as a bare container with no realm import step) — closing that gap is straightforward now that the root cause is understood.
