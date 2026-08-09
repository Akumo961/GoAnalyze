import hashlib
import hmac
import json

from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db.repositories import AuditRepository
from .models import AuditEvent


class AuditLog:
    """Hash-chained, tenant-scoped audit trail persisted to PostgreSQL.

    Each event's ``event_hash`` is an HMAC over the event payload plus the
    previous event's hash for that tenant, so any tampering with historical
    records breaks the chain.

    Concurrency: a naive "read the latest event, then write a new one
    referencing it" is a classic read-then-write race. Two concurrent
    appends for the *same tenant* can otherwise both read the same head and
    both link to it, forking the chain. This was confirmed via a real
    concurrency test against PostgreSQL, reproducible at every concurrency
    level tried (10 through 300 concurrent writers). An initial fix using a
    PostgreSQL advisory transaction lock (`pg_advisory_xact_lock`) did NOT
    reliably prevent forks in testing -- the lock was verified in isolation
    to serialize correctly, but forks still occurred at scale in the real
    append path for reasons not fully root-caused before the approach was
    abandoned in favor of a more standard, provably-correct mechanism (see
    FINAL_DATABASE_AUDIT.md for the full investigation).

    The current mechanism instead uses a dedicated `audit_chain_state`
    table (one row per tenant, holding the current chain head) and takes a
    real `SELECT ... FOR UPDATE` row lock on that tenant's row before
    reading the head and writing the next event -- see
    `AuditRepository.append_with_chain_lock`. This is standard Postgres row
    locking, not an advisory lock, and was verified with the same
    concurrency tests to produce zero forks at every level tried.
    """

    async def append(self, session: AsyncSession, event: AuditEvent) -> AuditEvent:
        return await AuditRepository(session).append_with_chain_lock(event, self._hash_event)

    async def list_events(self, session: AsyncSession, tenant_id: str) -> list[AuditEvent]:
        return await AuditRepository(session).list_for_tenant(tenant_id)

    async def list_events_paginated(
        self, session: AsyncSession, tenant_id: str, page: int, page_size: int
    ) -> tuple[list[AuditEvent], int]:
        return await AuditRepository(session).list_for_tenant_paginated(tenant_id, page, page_size)

    def _hash_event(self, event: AuditEvent) -> str:
        secret = get_settings().audit_hash_secret.encode("utf-8")
        payload = event.model_dump(mode="json")
        payload["event_hash"] = None
        serialized = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hmac.new(secret, serialized, hashlib.sha256).hexdigest()


audit_log = AuditLog()
