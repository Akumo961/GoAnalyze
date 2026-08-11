import os

# Point the app at an isolated in-memory-like SQLite DB and enable the
# explicit dev-auth opt-in *before* gov_platform.config is imported anywhere,
# so tests never touch a real Postgres/Keycloak instance.
os.environ.setdefault("GOV_ENVIRONMENT", "development")
os.environ.setdefault("GOV_DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("GOV_ALLOW_INSECURE_DEV_AUTH", "true")
os.environ.setdefault("GOV_AUDIT_HASH_SECRET", "test-only-secret-do-not-use-in-prod")
os.environ.setdefault("GOV_KEYCLOAK_ISSUER", "https://keycloak.test/realms/goanalyze")
os.environ.setdefault("GOV_KEYCLOAK_AUDIENCE", "goanalyze-api")
# Disabled by default so unrelated tests don't pay the cost of a doomed
# connection attempt to a nonexistent Redis; tests/test_rate_limit.py
# re-enables it explicitly and injects fakeredis.
os.environ.setdefault("GOV_RATE_LIMIT_ENABLED", "false")
# Avoid a real race: pytest's stdout capture/teardown conflicts with
# OpenTelemetry's background span-export thread when the console exporter
# is active (see FINAL_OBSERVABILITY_REPORT.md). Tracing correctness itself
# is validated by dedicated standalone scripts, not by the pytest suite.
os.environ.setdefault("GOV_OTEL_TRACING_ENABLED", "false")

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from gov_platform.db.models import Base
from gov_platform.storage import InMemoryObjectStorage


@pytest_asyncio.fixture
async def db_engine():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine) -> AsyncSession:
    sessionmaker = async_sessionmaker(bind=db_engine, expire_on_commit=False, class_=AsyncSession)
    async with sessionmaker() as session:
        yield session


@pytest_asyncio.fixture
async def app(db_engine):
    """The FastAPI app with its DB and object-storage dependencies
    overridden to isolated, in-memory test doubles."""
    from gov_platform.db.session import get_session
    from gov_platform.main import app as fastapi_app
    from gov_platform.storage import get_object_storage

    sessionmaker = async_sessionmaker(bind=db_engine, expire_on_commit=False, class_=AsyncSession)

    async def _override_get_session():
        async with sessionmaker() as session:
            yield session

    test_storage = InMemoryObjectStorage()

    async def _override_get_object_storage():
        return test_storage

    fastapi_app.dependency_overrides[get_session] = _override_get_session
    fastapi_app.dependency_overrides[get_object_storage] = _override_get_object_storage
    yield fastapi_app
    fastapi_app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as async_client:
        yield async_client


# --- shared JWT test helpers -------------------------------------------
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

from gov_platform import security
from gov_platform.config import Settings

TEST_ISSUER = "https://keycloak.test/realms/goanalyze"
TEST_AUDIENCE = "goanalyze-api"
TEST_KEY_ID = "test-signing-key-1"


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


@pytest.fixture
def rsa_keys():
    private_pem, public_pem = _generate_rsa_keypair()
    public_key = serialization.load_pem_public_key(public_pem)
    public_jwk = RSAAlgorithm.to_jwk(public_key, as_dict=True)
    public_jwk["kid"] = TEST_KEY_ID
    public_jwk["alg"] = "RS256"
    return private_pem, public_jwk


@pytest.fixture
def patched_auth(monkeypatch, rsa_keys):
    _, public_jwk = rsa_keys
    test_settings = Settings(
        keycloak_issuer=TEST_ISSUER,
        keycloak_audience=TEST_AUDIENCE,
        environment="development",
        allow_insecure_dev_auth=False,
        audit_hash_secret="test-secret",
        rate_limit_enabled=False,
    )
    monkeypatch.setattr(security, "get_settings", lambda: test_settings)

    async def fake_get_jwks(jwks_uri, *, force_refresh=False):
        return [public_jwk]

    monkeypatch.setattr(security, "_get_jwks", fake_get_jwks)
    return test_settings


def make_token(private_pem, tenant_id="ministry-a", roles=None, sub="user-1"):
    now = datetime.now(UTC)
    claims = {
        "iss": TEST_ISSUER,
        "aud": TEST_AUDIENCE,
        "sub": sub,
        "iat": now,
        "exp": now + timedelta(minutes=10),
        "tenant_id": tenant_id,
        "roles": roles if roles is not None else ["case-reviewer"],
    }
    return jwt.encode(claims, private_pem, algorithm="RS256", headers={"kid": TEST_KEY_ID})
