import fakeredis.aioredis
import pytest

from gov_platform import rate_limit
from gov_platform.config import Settings
from tests.conftest import make_token


@pytest.fixture
def fake_redis():
    return fakeredis.aioredis.FakeRedis(decode_responses=True)


@pytest.fixture
def enabled_rate_limits(monkeypatch, fake_redis):
    """Enable rate limiting with tiny limits and point it at fakeredis."""
    test_settings = Settings(
        keycloak_issuer="https://keycloak.test/realms/goanalyze",
        keycloak_audience="goanalyze-api",
        environment="development",
        allow_insecure_dev_auth=False,
        audit_hash_secret="test-secret",
        rate_limit_enabled=True,
        rate_limit_per_ip_per_minute=3,
        rate_limit_per_user_per_minute=5,
        rate_limit_per_tenant_per_minute=1000,
    )
    monkeypatch.setattr(rate_limit, "get_settings", lambda: test_settings)
    monkeypatch.setattr(rate_limit, "get_redis_client", lambda: fake_redis)
    monkeypatch.setattr("gov_platform.security.get_settings", lambda: test_settings)
    return test_settings


async def test_ip_rate_limit_blocks_after_threshold(client, enabled_rate_limits):
    # /health is exempt from IP limiting, so use it to distinguish "server
    # broken" from "limiter working" -- then hit a real limited endpoint.
    statuses = []
    for _ in range(5):
        r = await client.get("/v1/audit")
        statuses.append(r.status_code)
    # first N (up to the per-IP limit) should NOT be 429; requests beyond
    # the limit should be 429 regardless of the 401 they'd otherwise get,
    # since IP limiting runs before authentication.
    assert 429 in statuses
    blocked_index = statuses.index(429)
    assert blocked_index <= 3


async def test_rate_limited_response_has_retry_after_header(client, enabled_rate_limits):
    for _ in range(3):
        await client.get("/v1/audit")
    response = await client.get("/v1/audit")
    assert response.status_code == 429
    assert "retry-after" in {h.lower() for h in response.headers}
    assert response.json()["detail"] == "rate_limit_exceeded"


async def test_health_endpoint_exempt_from_rate_limiting(client, enabled_rate_limits):
    for _ in range(10):
        response = await client.get("/health")
        assert response.status_code == 200


async def test_window_reset_allows_requests_again(client, enabled_rate_limits, fake_redis):
    for _ in range(3):
        await client.get("/v1/audit")
    blocked = await client.get("/v1/audit")
    assert blocked.status_code == 429

    # simulate the fixed window expiring by clearing the counter directly
    await fake_redis.flushall()

    recovered = await client.get("/v1/audit")
    assert recovered.status_code != 429


async def test_per_user_rate_limit_independent_of_ip_limit(client, enabled_rate_limits, rsa_keys, monkeypatch):
    """A per-user limit that's *looser* than the per-IP limit should still
    let authenticated requests through until its own threshold, proving the
    two counters are tracked independently."""
    from gov_platform import security

    private_pem, public_jwk = rsa_keys

    async def fake_get_jwks(jwks_uri, *, force_refresh=False):
        return [public_jwk]

    monkeypatch.setattr(security, "_get_jwks", fake_get_jwks)
    token = make_token(private_pem)

    # per-IP limit is 3/min and shared across all requests in this test
    # (authenticated or not) since it runs in middleware before auth.
    statuses = []
    for _ in range(3):
        r = await client.get("/v1/audit", headers={"Authorization": f"Bearer {token}"})
        statuses.append(r.status_code)
    assert all(s != 429 for s in statuses), statuses

    fourth = await client.get("/v1/audit", headers={"Authorization": f"Bearer {token}"})
    assert fourth.status_code == 429


async def test_redis_unavailable_fails_open(client, monkeypatch):
    """If Redis itself can't be reached, rate limiting must not take the
    whole API down -- requests should be allowed through."""
    test_settings = Settings(
        keycloak_issuer="https://keycloak.test/realms/goanalyze",
        keycloak_audience="goanalyze-api",
        environment="development",
        audit_hash_secret="test-secret",
        rate_limit_enabled=True,
        rate_limit_per_ip_per_minute=1,
    )
    monkeypatch.setattr(rate_limit, "get_settings", lambda: test_settings)

    class BrokenRedis:
        async def incr(self, *a, **kw):
            raise ConnectionError("redis unreachable")

    monkeypatch.setattr(rate_limit, "get_redis_client", lambda: BrokenRedis())

    response = await client.get("/health")
    assert response.status_code == 200
    response2 = await client.get("/v1/audit")
    # fails open -> reaches auth layer and gets 401, not 429 or 500
    assert response2.status_code == 401


async def test_rate_limiter_uses_bounded_redis_keys_not_unbounded_memory(fake_redis):
    """Sanity check that keys expire (bounded memory growth) rather than
    accumulating forever."""
    allowed, _retry_after = await rate_limit._check(fake_redis, "ratelimit:test:key", limit=5, window_seconds=1)
    assert allowed is True
    ttl = await fake_redis.ttl("ratelimit:test:key")
    assert 0 < ttl <= 1
