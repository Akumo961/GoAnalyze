from gov_platform import search as search_service
from tests.conftest import make_token


async def _ingest(client, token, filename, tenant="ministry-a", content_type="application/pdf", sha256="a" * 64):
    return await client.post(
        "/v1/documents",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "tenant_id": tenant,
            "filename": filename,
            "content_type": content_type,
            "sha256": sha256,
            "object_uri": "s3://x/irrelevant",
        },
    )


async def test_search_requires_authentication(client):
    response = await client.get("/v1/documents/search", params={"q": "report"})
    assert response.status_code == 401


async def test_search_falls_back_to_database_when_opensearch_unreachable(client, patched_auth, rsa_keys):
    """settings.opensearch_url points nowhere reachable in tests, so every
    search call should transparently use the database fallback."""
    private_pem, _ = rsa_keys
    token = make_token(private_pem)
    await _ingest(client, token, "annual_report_2025.pdf", sha256="a" * 64)
    await _ingest(client, token, "budget_summary.pdf", sha256="b" * 64)

    response = await client.get("/v1/documents/search", params={"q": "report"}, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    body = response.json()
    assert body["backend"] == "database_fallback"
    assert body["total"] == 1
    assert body["results"][0]["filename"] == "annual_report_2025.pdf"


async def test_search_is_tenant_isolated(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token_a = make_token(private_pem, tenant_id="ministry-a")
    token_b = make_token(private_pem, tenant_id="ministry-b")

    await _ingest(client, token_a, "ministry_a_confidential.pdf", tenant="ministry-a", sha256="c" * 64)
    await _ingest(client, token_b, "ministry_b_confidential.pdf", tenant="ministry-b", sha256="d" * 64)

    response = await client.get(
        "/v1/documents/search", params={"q": "confidential"}, headers={"Authorization": f"Bearer {token_b}"}
    )
    body = response.json()
    filenames = [hit["filename"] for hit in body["results"]]
    assert "ministry_a_confidential.pdf" not in filenames
    assert "ministry_b_confidential.pdf" in filenames


async def test_search_pagination(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token = make_token(private_pem)
    for i in range(5):
        await _ingest(client, token, f"page_test_{i}.pdf", sha256=format(i, "064x"))

    page1 = await client.get(
        "/v1/documents/search", params={"q": "page_test", "page": 1, "page_size": 2}, headers={"Authorization": f"Bearer {token}"}
    )
    page2 = await client.get(
        "/v1/documents/search", params={"q": "page_test", "page": 2, "page_size": 2}, headers={"Authorization": f"Bearer {token}"}
    )
    assert page1.status_code == 200 and page2.status_code == 200
    assert page1.json()["total"] == 5
    assert len(page1.json()["results"]) == 2
    assert len(page2.json()["results"]) == 2
    assert {r["filename"] for r in page1.json()["results"]}.isdisjoint({r["filename"] for r in page2.json()["results"]})


async def test_search_filters_by_classification(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token = make_token(private_pem)
    await client.post(
        "/v1/documents",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "tenant_id": "ministry-a",
            "filename": "public_notice.pdf",
            "content_type": "application/pdf",
            "classification": "public",
            "sha256": "e" * 64,
            "object_uri": "s3://x/e.pdf",
        },
    )
    response = await client.get(
        "/v1/documents/search",
        params={"q": "", "classification": "public"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert all(r["classification"] == "public" for r in response.json()["results"])


async def test_search_rejects_invalid_pagination(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token = make_token(private_pem)
    response = await client.get(
        "/v1/documents/search", params={"page": 0}, headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 422

    response = await client.get(
        "/v1/documents/search", params={"page_size": 500}, headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 422


async def test_opensearch_query_shape_and_response_parsing(monkeypatch, db_session):
    """Unit-level test of the real OpenSearch REST integration: monkeypatch
    the HTTP layer to return a canned OpenSearch-style response and confirm
    the request is built correctly (tenant filter always present) and the
    response is parsed correctly -- without needing a live cluster."""
    import httpx

    captured = {}

    class FakeResponse:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            pass

        def json(self):
            return self._payload

    async def fake_post(self, url, json=None, **kwargs):
        captured["url"] = url
        captured["body"] = json
        return FakeResponse(
            {
                "hits": {
                    "total": {"value": 1},
                    "hits": [
                        {
                            "_id": "11111111-1111-1111-1111-111111111111",
                            "_score": 3.14,
                            "_source": {
                                "filename": "opensearch_result.pdf",
                                "content_type": "application/pdf",
                                "classification": "internal",
                                "created_at": "2026-01-01T00:00:00+00:00",
                            },
                            "highlight": {"filename": ["<em>opensearch</em>_result.pdf"]},
                        }
                    ],
                }
            }
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    result = await search_service.search(db_session, tenant_id="ministry-a", query="opensearch", page=1, page_size=10)

    assert result.backend == "opensearch"
    assert result.total == 1
    assert result.results[0].filename == "opensearch_result.pdf"
    assert result.results[0].score == 3.14
    # tenant isolation must be enforced in the query sent to OpenSearch itself
    must_clauses = captured["body"]["query"]["bool"]["must"]
    assert {"term": {"tenant_id": "ministry-a"}} in must_clauses
