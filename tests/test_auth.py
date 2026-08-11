from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from jwt.algorithms import RSAAlgorithm

from gov_platform import security
from gov_platform.config import Settings


def _generate_rsa_keypair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return private_pem, public_pem


TEST_ISSUER = "https://keycloak.test/realms/goanalyze"
TEST_AUDIENCE = "goanalyze-api"
KEY_ID = "test-signing-key-1"


@pytest.fixture
def rsa_keys():
    private_pem, public_pem = _generate_rsa_keypair()
    public_key = serialization.load_pem_public_key(public_pem)
    public_jwk = RSAAlgorithm.to_jwk(public_key, as_dict=True)
    public_jwk["kid"] = KEY_ID
    public_jwk["alg"] = "RS256"
    return private_pem, public_jwk


@pytest.fixture(autouse=True)
def patched_settings(monkeypatch, rsa_keys):
    _, public_jwk = rsa_keys
    test_settings = Settings(
        keycloak_issuer=TEST_ISSUER,
        keycloak_audience=TEST_AUDIENCE,
        environment="development",
        allow_insecure_dev_auth=False,
        audit_hash_secret="test-secret",
    )
    monkeypatch.setattr(security, "get_settings", lambda: test_settings)

    async def fake_get_jwks(jwks_uri, *, force_refresh=False):
        return [public_jwk]

    monkeypatch.setattr(security, "_get_jwks", fake_get_jwks)
    return test_settings


def _make_token(
    private_pem,
    *,
    exp_delta=timedelta(minutes=5),
    issuer=TEST_ISSUER,
    audience=TEST_AUDIENCE,
    algorithm="RS256",
    key_id=KEY_ID,
    **extra_claims,
):
    now = datetime.now(UTC)
    claims = {
        "iss": issuer,
        "aud": audience,
        "sub": "user-123",
        "iat": now,
        "exp": now + exp_delta,
        "tenant_id": "ministry-a",
        "roles": ["case-reviewer"],
        **extra_claims,
    }
    return jwt.encode(claims, private_pem, algorithm=algorithm, headers={"kid": key_id})


async def test_valid_token_is_accepted(rsa_keys):
    private_pem, _ = rsa_keys
    token = _make_token(private_pem)

    claims = await security.verify_bearer_token(token)

    assert claims["tenant_id"] == "ministry-a"
    assert claims["sub"] == "user-123"


async def test_expired_token_is_rejected(rsa_keys):
    private_pem, _ = rsa_keys
    token = _make_token(private_pem, exp_delta=timedelta(minutes=-5))

    with pytest.raises(HTTPException) as excinfo:
        await security.verify_bearer_token(token)

    assert excinfo.value.status_code == 401


async def test_wrong_audience_is_rejected(rsa_keys):
    private_pem, _ = rsa_keys
    token = _make_token(private_pem, audience="some-other-api")

    with pytest.raises(HTTPException) as excinfo:
        await security.verify_bearer_token(token)

    assert excinfo.value.status_code == 401


async def test_wrong_issuer_is_rejected(rsa_keys):
    private_pem, _ = rsa_keys
    token = _make_token(private_pem, issuer="https://attacker.example/realms/fake")

    with pytest.raises(HTTPException) as excinfo:
        await security.verify_bearer_token(token)

    assert excinfo.value.status_code == 401


async def test_forged_signature_is_rejected(rsa_keys):
    # Signed with a *different* key than the one published in the JWKS.
    other_private_pem, _ = _generate_rsa_keypair()
    token = _make_token(other_private_pem)

    with pytest.raises(HTTPException) as excinfo:
        await security.verify_bearer_token(token)

    assert excinfo.value.status_code == 401


async def test_missing_tenant_claim_is_rejected(rsa_keys):
    private_pem, _ = rsa_keys
    now = datetime.now(UTC)
    claims = {
        "iss": TEST_ISSUER,
        "aud": TEST_AUDIENCE,
        "sub": "user-123",
        "iat": now,
        "exp": now + timedelta(minutes=5),
    }
    token = jwt.encode(claims, private_pem, algorithm="RS256", headers={"kid": KEY_ID})

    with pytest.raises(HTTPException) as excinfo:
        await security.verify_bearer_token(token)

    assert excinfo.value.status_code == 401


async def test_missing_subject_claim_is_rejected(rsa_keys):
    private_pem, _ = rsa_keys
    token = _make_token(private_pem, sub=None)

    with pytest.raises(HTTPException) as excinfo:
        await security.verify_bearer_token(token)

    assert excinfo.value.status_code == 401


async def test_missing_expiration_is_rejected(rsa_keys):
    private_pem, _ = rsa_keys
    now = datetime.now(UTC)
    token = jwt.encode(
        {
            "iss": TEST_ISSUER,
            "aud": TEST_AUDIENCE,
            "sub": "user-123",
            "iat": now,
            "tenant_id": "ministry-a",
        },
        private_pem,
        algorithm="RS256",
        headers={"kid": KEY_ID},
    )

    with pytest.raises(HTTPException) as excinfo:
        await security.verify_bearer_token(token)

    assert excinfo.value.status_code == 401


async def test_unknown_kid_forces_one_jwks_refresh(monkeypatch, rsa_keys):
    private_pem, _ = rsa_keys
    token = _make_token(private_pem, key_id="unknown-key")
    calls = []

    async def fake_get_jwks(jwks_uri, *, force_refresh=False):
        calls.append(force_refresh)
        return []

    monkeypatch.setattr(security, "_get_jwks", fake_get_jwks)

    with pytest.raises(HTTPException) as excinfo:
        await security.verify_bearer_token(token)

    assert excinfo.value.status_code == 401
    assert excinfo.value.detail == "unknown_signing_key"
    assert calls == [False, True]


async def test_jwks_key_rotation_is_accepted_after_forced_refresh(monkeypatch, rsa_keys):
    _, old_jwk = rsa_keys
    rotated_private_pem, rotated_public_pem = _generate_rsa_keypair()
    rotated_jwk = RSAAlgorithm.to_jwk(
        serialization.load_pem_public_key(rotated_public_pem), as_dict=True
    )
    rotated_jwk.update({"kid": "rotated-key", "alg": "RS256"})
    token = _make_token(rotated_private_pem, key_id="rotated-key")
    calls = []

    async def fake_get_jwks(jwks_uri, *, force_refresh=False):
        calls.append(force_refresh)
        return [rotated_jwk] if force_refresh else [old_jwk]

    monkeypatch.setattr(security, "_get_jwks", fake_get_jwks)

    assert (await security.verify_bearer_token(token))["sub"] == "user-123"
    assert calls == [False, True]


async def test_malformed_jwt_is_rejected():
    with pytest.raises(HTTPException) as excinfo:
        await security.verify_bearer_token("not-a-jwt")

    assert excinfo.value.status_code == 401
    assert excinfo.value.detail == "malformed_token"


async def test_hs256_token_is_rejected(rsa_keys):
    token = _make_token("hmac-test-secret-that-is-at-least-32-bytes", algorithm="HS256")

    with pytest.raises(HTTPException) as excinfo:
        await security.verify_bearer_token(token)

    assert excinfo.value.status_code == 401


@pytest.mark.parametrize("algorithm", ["RS384", "RS512"])
async def test_other_allowed_rsa_algorithms_are_accepted(rsa_keys, algorithm):
    private_pem, _ = rsa_keys
    token = _make_token(private_pem, algorithm=algorithm)

    assert (await security.verify_bearer_token(token))["sub"] == "user-123"


async def test_legacy_colon_format_dev_token_is_no_longer_valid(rsa_keys):
    """Regression test for the historical vulnerability: a plain
    'tenant:<id>:<roles>' string (no signature at all) must never be
    accepted as a bearer token."""
    forged = "tenant:ministry-a:platform-admin,protected-b-reader"

    with pytest.raises(HTTPException) as excinfo:
        await security.verify_bearer_token(forged)

    assert excinfo.value.status_code == 401


async def test_dev_header_bypass_disabled_by_default(db_session):
    """Even in development, header-based auth must be refused unless
    GOV_ALLOW_INSECURE_DEV_AUTH is explicitly set."""
    from starlette.requests import Request

    scope = {
        "type": "http",
        "headers": [(b"x-tenant-id", b"ministry-a"), (b"x-roles", b"platform-admin")],
        "method": "GET",
        "path": "/",
    }
    request = Request(scope)

    with pytest.raises(HTTPException) as excinfo:
        await security.get_current_context(request, credentials=None, session=db_session)

    assert excinfo.value.status_code == 401
