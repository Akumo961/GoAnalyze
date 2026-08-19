/**
 * Keycloak authentication via the OIDC Authorization Code + PKCE flow.
 *
 * We intentionally do NOT implement a fake/local auth system. The frontend
 * redirects the browser to the real Keycloak login page
 * (config.keycloakIssuer) and exchanges the returned authorization code for
 * tokens using the standard OIDC token endpoint. No client secret is ever
 * held by the frontend (PKCE removes the need for one on a public client).
 *
 * BACKEND GAP: the docker-compose Keycloak instance starts with no realm,
 * clients, or users provisioned -- see FRONTEND_BACKEND_GAPS.md. Until a
 * "goanalyze" realm and a public "goanalyze-frontend" client (matching
 * config.keycloakClientId) with redirect URI
 * "<frontend-origin>/login/callback" exist, the login redirect will reach
 * Keycloak but fail at the realm/client lookup. That is a deployment
 * configuration gap, not a frontend bug.
 */

import { config, oidcRedirectUri } from "./config";

const TOKEN_STORAGE_KEY = "goanalyze_auth_tokens";
const PKCE_VERIFIER_KEY = "goanalyze_pkce_verifier";
const AUTH_STATE_KEY = "goanalyze_oauth_state";
const POST_LOGIN_REDIRECT_KEY = "goanalyze_post_login_redirect";

export interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_at: number; // epoch ms
  token_type: string;
}

export interface DecodedUser {
  sub: string;
  preferred_username?: string;
  email?: string;
  name?: string;
  realm_access?: { roles?: string[] };
  [key: string]: unknown;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = "";
  bytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(input: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

function randomString(length = 64): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return base64UrlEncode(array).slice(0, length);
}

function discoveryUrls() {
  const issuer = config.keycloakIssuer.replace(/\/$/, "");
  return {
    authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
    token_endpoint: `${issuer}/protocol/openid-connect/token`,
    end_session_endpoint: `${issuer}/protocol/openid-connect/logout`
  };
}

export function getStoredTokens(): StoredTokens | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

function storeTokens(tokens: StoredTokens) {
  window.sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
}

export function clearTokens() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function isTokenExpired(tokens: StoredTokens | null): boolean {
  if (!tokens) return true;
  // 30s clock-skew buffer
  return Date.now() >= tokens.expires_at - 30_000;
}

export function decodeJwt<T = DecodedUser>(token: string): T | null {
  try {
    const payload = token.split(".")[1];
    const json = decodeURIComponent(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export function getCurrentUser(): DecodedUser | null {
  const tokens = getStoredTokens();
  if (!tokens) return null;
  return decodeJwt(tokens.access_token);
}

/** Kicks off the redirect to Keycloak's login page. */
export async function login(redirectAfter = "/dashboard") {
  const verifier = randomString(64);
  const challengeBytes = await sha256(verifier);
  const challenge = base64UrlEncode(challengeBytes);
  const state = randomString(24);

  window.sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  window.sessionStorage.setItem(AUTH_STATE_KEY, state);
  window.sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, redirectAfter);

  const params = new URLSearchParams({
    client_id: config.keycloakClientId,
    redirect_uri: oidcRedirectUri(),
    response_type: "code",
    scope: "openid profile email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  });

  window.location.href = `${discoveryUrls().authorization_endpoint}?${params.toString()}`;
}

/** Called from /login/callback once Keycloak redirects back with ?code=&state=. */
export async function completeLogin(code: string, state: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const expectedState = window.sessionStorage.getItem(AUTH_STATE_KEY);
  const verifier = window.sessionStorage.getItem(PKCE_VERIFIER_KEY);

  if (!verifier || !expectedState || state !== expectedState) {
    return { ok: false, error: "Invalid or expired login state. Please try signing in again." };
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.keycloakClientId,
    redirect_uri: oidcRedirectUri(),
    code,
    code_verifier: verifier
  });

  let response: Response;
  try {
    response = await fetch(discoveryUrls().token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
  } catch {
    return {
      ok: false,
      error:
        "Could not reach the Keycloak token endpoint. Check that Keycloak is running and reachable from your browser."
    };
  }

  if (!response.ok) {
    return { ok: false, error: `Keycloak rejected the login (HTTP ${response.status}).` };
  }

  const data = await response.json();
  storeTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    id_token: data.id_token,
    token_type: data.token_type ?? "Bearer",
    expires_at: Date.now() + (data.expires_in ?? 300) * 1000
  });

  window.sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  window.sessionStorage.removeItem(AUTH_STATE_KEY);
  return { ok: true };
}

export function consumePostLoginRedirect(): string {
  const target = window.sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY) || "/dashboard";
  window.sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
  return target;
}

/** Attempts a silent refresh using the stored refresh_token. */
export async function refreshTokens(): Promise<StoredTokens | null> {
  const current = getStoredTokens();
  if (!current?.refresh_token) return null;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.keycloakClientId,
    refresh_token: current.refresh_token
  });

  try {
    const response = await fetch(discoveryUrls().token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    if (!response.ok) {
      clearTokens();
      return null;
    }
    const data = await response.json();
    const tokens: StoredTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? current.refresh_token,
      id_token: data.id_token,
      token_type: data.token_type ?? "Bearer",
      expires_at: Date.now() + (data.expires_in ?? 300) * 1000
    };
    storeTokens(tokens);
    return tokens;
  } catch {
    return null;
  }
}

export function logout() {
  const tokens = getStoredTokens();
  clearTokens();
  const params = new URLSearchParams({
    client_id: config.keycloakClientId,
    post_logout_redirect_uri: typeof window !== "undefined" ? window.location.origin + "/login" : ""
  });
  if (tokens?.id_token) params.set("id_token_hint", tokens.id_token);
  if (typeof window !== "undefined") {
    window.location.href = `${discoveryUrls().end_session_endpoint}?${params.toString()}`;
  }
}

/**
 * Returns a valid access token, refreshing it first if it's expired/near
 * expiry. Returns null if the user isn't authenticated at all.
 */
export async function getValidAccessToken(): Promise<string | null> {
  let tokens = getStoredTokens();
  if (!tokens) return null;
  if (isTokenExpired(tokens)) {
    tokens = await refreshTokens();
  }
  return tokens?.access_token ?? null;
}

export function isAuthenticated(): boolean {
  return !isTokenExpired(getStoredTokens());
}
