"""Redis-backed rate limiting.

Three independent limiters, all configurable via ``Settings``:

* per-IP -- applied to every request (including unauthenticated ones) at
  the ASGI middleware layer, so it also protects auth endpoints against
  credential-stuffing / brute force.
* per-user and per-tenant -- applied once a request has been authenticated
  (inside ``get_current_context``), keyed off the verified JWT subject and
  tenant claim -- never off client-supplied headers.

Uses a simple fixed-window counter (``INCR`` + ``EXPIRE``), which is O(1)
per request and easy to reason about; sufficient for this API's traffic
shape. If Redis itself is unreachable, limiting fails *open* (requests are
allowed through, with a warning logged) rather than taking the whole API
down -- availability of the core service takes priority over the abuse
control when the abuse-control dependency itself is down.
"""

from __future__ import annotations

import logging
from functools import lru_cache

from fastapi import HTTPException, Request, status
from redis.asyncio import Redis

from .config import get_settings

logger = logging.getLogger(__name__)


@lru_cache
def get_redis_client() -> Redis:
    settings = get_settings()
    return Redis.from_url(settings.redis_url, decode_responses=True, socket_connect_timeout=1, socket_timeout=1)


async def _check(redis: Redis, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
    current = await redis.incr(key)
    if current == 1:
        await redis.expire(key, window_seconds)
    if current > limit:
        ttl = await redis.ttl(key)
        return False, max(ttl, 1)
    return True, 0


async def _enforce(redis: Redis, key: str, limit: int, window_seconds: int = 60) -> None:
    allowed, retry_after = await _check(redis, key, limit, window_seconds)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="rate_limit_exceeded",
            headers={"Retry-After": str(retry_after)},
        )


async def enforce_ip_rate_limit(request: Request) -> None:
    settings = get_settings()
    if not settings.rate_limit_enabled:
        return
    client_ip = request.client.host if request.client else "unknown"
    try:
        redis = get_redis_client()
        await _enforce(redis, f"ratelimit:ip:{client_ip}", settings.rate_limit_per_ip_per_minute)
    except HTTPException:
        raise
    except Exception:
        logger.warning("Rate limiter (Redis) unreachable; failing open for IP limit", exc_info=True)


async def enforce_identity_rate_limits(tenant_id: str, subject: str) -> None:
    settings = get_settings()
    if not settings.rate_limit_enabled:
        return
    try:
        redis = get_redis_client()
        await _enforce(redis, f"ratelimit:user:{subject}", settings.rate_limit_per_user_per_minute)
        await _enforce(redis, f"ratelimit:tenant:{tenant_id}", settings.rate_limit_per_tenant_per_minute)
    except HTTPException:
        raise
    except Exception:
        logger.warning("Rate limiter (Redis) unreachable; failing open for user/tenant limit", exc_info=True)
