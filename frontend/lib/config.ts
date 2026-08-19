/**
 * Centralized runtime configuration.
 *
 * Every value here comes from NEXT_PUBLIC_* environment variables so it can
 * be set per-environment (local Docker, staging, production) without code
 * changes. Falls back to the documented local docker-compose defaults
 * (see GoAnalyze/.env) when a variable isn't set, which keeps `docker
 * compose up` working out of the box.
 */

function readEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

export const config = {
  /**
   * Base URL of the FastAPI backend, reachable from the *browser* (not from
   * inside the Docker network). This must stay a NEXT_PUBLIC_ variable
   * because it is read client-side.
   */
  apiBaseUrl: readEnv("NEXT_PUBLIC_GOV_API_URL", "http://localhost:8080"),

  /**
   * Keycloak issuer URL, reachable from the browser. The backend's own
   * issuer (GOV_KEYCLOAK_ISSUER=http://keycloak:8080/...) is a Docker-
   * internal hostname and is NOT reachable from the browser, so the
   * frontend needs its own browser-reachable value.
   */
  keycloakIssuer: readEnv(
    "NEXT_PUBLIC_KEYCLOAK_ISSUER",
    "http://localhost:8081/realms/goanalyze"
  ),

  /**
   * Public OIDC client id for the frontend. BACKEND GAP: no such client is
   * provisioned by the current docker-compose/.env -- see
   * FRONTEND_BACKEND_GAPS.md. Defaults to a conventional name so ops can
   * create a matching public client with PKCE enabled.
   */
  keycloakClientId: readEnv("NEXT_PUBLIC_KEYCLOAK_CLIENT_ID", "goanalyze-frontend"),

  /** Default tenant id used for demo/local ingestion when none is known yet. */
  defaultTenantId: readEnv("NEXT_PUBLIC_DEFAULT_TENANT_ID", "default"),

  /** Request timeout for API calls, in milliseconds. */
  apiTimeoutMs: Number(readEnv("NEXT_PUBLIC_API_TIMEOUT_MS", "30000")),

  appName: "GoAnalyze",
  appTagline: "Government Document Intelligence"
};

export function oidcRedirectUri(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/login/callback`;
}
