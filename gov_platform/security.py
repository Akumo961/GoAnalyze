"""Authentication and ABAC authorization.

Bearer tokens are verified as real OIDC JWTs issued by the configured
Keycloak realm: signature is checked against the realm's JWKS endpoint,
and issuer, audience, and expiration are all validated before any tenant
or role claim is trusted.

A header-based development shortcut (``x-tenant-id`` / ``x-roles``) still
exists for local iteration, but it is only reachable when
``GOV_ENVIRONMENT=development`` *and* ``GOV_ALLOW_INSECURE_DEV_AUTH=true``
are both explicitly set. It is refused unconditionally otherwise, including
in the default configuration.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt
from jose.exceptions import ExpiredSignatureError, JWTClaimsError, JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db.repositories import UserRepository
from .db.session import get_session
from .models import ClassificationLevel, TenantContext
from .rate_limit import enforce_identity_rate_limits

bearer = HTTPBearer(auto_error=False)

# Only accept asymmetric algorithms used by Keycloak.
ALLOWED_JWT_ALGORITHMS = {
    "RS256",
    "RS384",
    "RS512",
}

_JWKS_CACHE_TTL_SECONDS = 300
_jwks_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}

_RESERVED_CLAIMS = {
    "tenant_id",
    "ministry",
    "roles",
    "realm_access",
    "resource_access",
    "iss",
    "aud",
    "exp",
    "iat",
    "nbf",
    "sub",
}


@dataclass(frozen=True)
class PolicyDecision:
    allowed: bool
    reason: str


def evaluate_abac(
    context: TenantContext,
    action: str,
    resource_tenant_id: str,
    classification: ClassificationLevel,
    purpose: str,
) -> PolicyDecision:
    if context.tenant_id != resource_tenant_id and "platform-admin" not in context.roles:
        return PolicyDecision(False, "tenant_mismatch")
    if action.startswith("admin:") and "tenant-admin" not in context.roles:
        return PolicyDecision(False, "tenant_admin_required")
    if classification == ClassificationLevel.protected_b and "protected-b-reader" not in context.roles:
        return PolicyDecision(False, "protected_b_role_required")
    if purpose not in {"case-review", "audit", "operations", "legal-review"}:
        return PolicyDecision(False, "invalid_purpose")
    return PolicyDecision(True, "allowed")


def _jwks_uri() -> str:
    settings = get_settings()
    if settings.keycloak_jwks_url:
        return settings.keycloak_jwks_url
    return f"{str(settings.keycloak_issuer).rstrip('/')}/protocol/openid-connect/certs"


async def _fetch_jwks(jwks_uri: str) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.get(jwks_uri)
        response.raise_for_status()
    return response.json().get("keys", [])


async def _get_jwks(jwks_uri: str, *, force_refresh: bool = False) -> list[dict[str, Any]]:
    now = time.monotonic()
    cached = _jwks_cache.get(jwks_uri)
    if not force_refresh and cached is not None and now - cached[0] < _JWKS_CACHE_TTL_SECONDS:
        return cached[1]
    try:
        keys = await _fetch_jwks(jwks_uri)
    except httpx.HTTPError as exc:
        if cached is not None:
            # Serve stale keys rather than hard-failing auth on a transient
            # identity-provider outage.
            return cached[1]
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="identity_provider_unreachable"
        ) from exc
    _jwks_cache[jwks_uri] = (now, keys)
    return keys


async def verify_bearer_token(token: str) -> dict[str, Any]:
    """Validate signature, issuer, audience, and expiration of a Keycloak-issued JWT."""
    settings = get_settings()

    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="malformed_token") from exc

    kid = header.get("kid")
    jwks_uri = _jwks_uri()
    keys = await _get_jwks(jwks_uri)
    key = next((k for k in keys if k.get("kid") == kid), None)
    if key is None:
        # Key rotation: refresh once before giving up.
        keys = await _get_jwks(jwks_uri, force_refresh=True)
        key = next((k for k in keys if k.get("kid") == kid), None)
    if key is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unknown_signing_key")

    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=ALLOWED_JWT_ALGORITHMS,
            audience=settings.keycloak_audience,
            issuer=str(settings.keycloak_issuer),
            options={"require_exp": True},
        )
    except ExpiredSignatureError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="token_expired") from exc
    except JWTClaimsError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"invalid_claims:{exc}") from exc
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_signature") from exc

    if not claims.get("tenant_id"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing_tenant_claim")
    if not claims.get("sub"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing_subject_claim")

    return claims


def _extract_roles(claims: dict[str, Any]) -> set[str]:
    if isinstance(claims.get("roles"), list):
        return set(claims["roles"])
    realm_access = claims.get("realm_access")
    if isinstance(realm_access, dict) and isinstance(realm_access.get("roles"), list):
        return set(realm_access["roles"])
    return set()


async def get_current_context(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_session),
) -> TenantContext:
    settings = get_settings()

    if credentials is not None:
        claims = await verify_bearer_token(credentials.credentials)
        tenant_id = str(claims["tenant_id"])
        roles = _extract_roles(claims)
        ministry = str(claims.get("ministry", tenant_id))
        subject = str(claims["sub"])

        await enforce_identity_rate_limits(tenant_id=tenant_id, subject=subject)

        await UserRepository(session).upsert_from_token(
            subject=subject,
            tenant_id=tenant_id,
            ministry=ministry,
            email=claims.get("email"),
            roles=sorted(roles),
        )

        attributes = {k: v for k, v in claims.items() if k not in _RESERVED_CLAIMS}
        attributes["sub"] = subject
        return TenantContext(tenant_id=tenant_id, ministry=ministry, roles=roles, attributes=attributes)

    if settings.environment == "development" and settings.allow_insecure_dev_auth:
        tenant = request.headers.get("x-tenant-id")
        roles = set(filter(None, request.headers.get("x-roles", "").split(",")))
        ministry = request.headers.get("x-ministry", tenant or "development")
        if tenant:
            return TenantContext(tenant_id=tenant, ministry=ministry, roles=roles)

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing_or_invalid_bearer_token")
