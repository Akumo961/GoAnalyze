"""Full-text document search.

``SearchService`` always attempts OpenSearch first (real integration,
tenant-isolated via a mandatory server-side ``term`` filter on
``tenant_id`` -- a caller's query can never override this). If OpenSearch
is unreachable or not configured, it automatically falls back to a
PostgreSQL/SQLite ``ILIKE`` search over the ``documents`` table via
``DocumentRepository.search`` so the API keeps working during an
OpenSearch outage, at reduced (non-relevance-ranked) quality.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db.repositories import DocumentRepository
from .models import ClassificationLevel, DocumentRecord, SearchHit, SearchResponse

logger = logging.getLogger(__name__)


async def index_document(record: DocumentRecord) -> None:
    """Best-effort: indexing failures never block document ingestion."""
    settings = get_settings()
    document = {
        "tenant_id": record.tenant_id,
        "filename": record.filename,
        "content_type": record.content_type,
        "classification": record.classification.value
        if isinstance(record.classification, ClassificationLevel)
        else record.classification,
        "metadata": record.metadata,
        "created_at": record.created_at.isoformat(),
    }
    try:
        async with httpx.AsyncClient(base_url=settings.opensearch_url, timeout=3.0) as client:
            response = await client.put(f"/{settings.opensearch_index}/_doc/{record.id}?refresh=true", json=document)
            response.raise_for_status()
    except Exception:
        logger.info("OpenSearch indexing skipped (unreachable) for document %s", record.id, exc_info=True)


async def search(
    session: AsyncSession,
    tenant_id: str,
    query: str,
    page: int = 1,
    page_size: int = 20,
    classification: str | None = None,
    content_type: str | None = None,
) -> SearchResponse:
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)

    settings = get_settings()
    must: list[dict[str, Any]] = [{"term": {"tenant_id": tenant_id}}]
    if query:
        must.append({"multi_match": {"query": query, "fields": ["filename^2", "metadata.*"]}})
    if classification:
        must.append({"term": {"classification": classification}})
    if content_type:
        must.append({"term": {"content_type": content_type}})

    try:
        async with httpx.AsyncClient(base_url=settings.opensearch_url, timeout=3.0) as client:
            response = await client.post(
                f"/{settings.opensearch_index}/_search",
                json={
                    "query": {"bool": {"must": must}},
                    "from": (page - 1) * page_size,
                    "size": page_size,
                    "highlight": {"fields": {"filename": {}}},
                },
            )
            response.raise_for_status()
            payload = response.json()

        hits = payload["hits"]["hits"]
        total = payload["hits"]["total"]["value"]
        results = [
            SearchHit(
                document_id=hit["_id"],
                filename=hit["_source"]["filename"],
                content_type=hit["_source"]["content_type"],
                classification=hit["_source"]["classification"],
                score=hit.get("_score") or 0.0,
                highlight=" ".join(hit.get("highlight", {}).get("filename", [])) or None,
                created_at=hit["_source"]["created_at"],
            )
            for hit in hits
        ]
        return SearchResponse(query=query, total=total, page=page, page_size=page_size, backend="opensearch", results=results)
    except Exception:
        logger.info("OpenSearch unreachable, falling back to database search", exc_info=True)
        records, total = await DocumentRepository(session).search(
            tenant_id, query, page, page_size, classification=classification, content_type=content_type
        )
        results = [
            SearchHit(
                document_id=record.id,
                filename=record.filename,
                content_type=record.content_type,
                classification=record.classification,
                score=1.0 if query and query.lower() in record.filename.lower() else 0.5,
                highlight=None,
                created_at=record.created_at,
            )
            for record in records
        ]
        return SearchResponse(query=query, total=total, page=page, page_size=page_size, backend="database_fallback", results=results)
