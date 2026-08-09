from tests.conftest import make_token


async def _ingest_many(client, token, tenant, count, prefix="doc"):
    for i in range(count):
        await client.post(
            "/v1/documents",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "tenant_id": tenant,
                "filename": f"{prefix}_{i}.pdf",
                "content_type": "application/pdf",
                "sha256": format(i, "064x"),
                "object_uri": f"s3://x/{prefix}_{i}.pdf",
            },
        )


async def test_audit_first_page(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token = make_token(private_pem)
    await _ingest_many(client, token, "ministry-a", 5)  # 5 documents = 5 audit events

    response = await client.get("/v1/audit", params={"page": 1, "page_size": 2}, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    body = response.json()
    assert body["page"] == 1
    assert body["page_size"] == 2
    assert body["total"] == 5
    assert body["total_pages"] == 3
    assert len(body["items"]) == 2


async def test_audit_middle_page(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token = make_token(private_pem)
    await _ingest_many(client, token, "ministry-a", 5)

    response = await client.get("/v1/audit", params={"page": 2, "page_size": 2}, headers={"Authorization": f"Bearer {token}"})
    body = response.json()
    assert response.status_code == 200
    assert body["page"] == 2
    assert len(body["items"]) == 2


async def test_audit_last_page_partial(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token = make_token(private_pem)
    await _ingest_many(client, token, "ministry-a", 5)

    response = await client.get("/v1/audit", params={"page": 3, "page_size": 2}, headers={"Authorization": f"Bearer {token}"})
    body = response.json()
    assert response.status_code == 200
    assert body["page"] == 3
    assert len(body["items"]) == 1  # 5 items, page_size 2 -> last page has 1


async def test_audit_empty_page_past_end(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token = make_token(private_pem)
    await _ingest_many(client, token, "ministry-a", 3)

    response = await client.get("/v1/audit", params={"page": 99, "page_size": 10}, headers={"Authorization": f"Bearer {token}"})
    body = response.json()
    assert response.status_code == 200
    assert body["items"] == []
    assert body["total"] == 3


async def test_audit_empty_tenant_no_events(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token = make_token(private_pem, tenant_id="ministry-empty")

    response = await client.get("/v1/audit", headers={"Authorization": f"Bearer {token}"})
    body = response.json()
    assert response.status_code == 200
    assert body == {"total": 0, "page": 1, "page_size": 20, "total_pages": 0, "items": []}


async def test_audit_invalid_page_rejected(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token = make_token(private_pem)

    response = await client.get("/v1/audit", params={"page": 0}, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 422
    assert response.json()["detail"] == "page_must_be_positive"

    response = await client.get("/v1/audit", params={"page": -5}, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 422


async def test_audit_invalid_page_size_rejected(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token = make_token(private_pem)

    response = await client.get("/v1/audit", params={"page_size": 0}, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 422

    response = await client.get("/v1/audit", params={"page_size": 101}, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 422
    assert response.json()["detail"] == "page_size_must_be_between_1_and_100"


async def test_audit_maximum_page_size_accepted(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token = make_token(private_pem)
    await _ingest_many(client, token, "ministry-a", 3)

    response = await client.get("/v1/audit", params={"page_size": 100}, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["page_size"] == 100


async def test_audit_pagination_respects_tenant_isolation(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token_a = make_token(private_pem, tenant_id="ministry-a")
    token_b = make_token(private_pem, tenant_id="ministry-b")
    await _ingest_many(client, token_a, "ministry-a", 4, prefix="a_doc")
    await _ingest_many(client, token_b, "ministry-b", 2, prefix="b_doc")

    response_a = await client.get("/v1/audit", params={"page_size": 100}, headers={"Authorization": f"Bearer {token_a}"})
    response_b = await client.get("/v1/audit", params={"page_size": 100}, headers={"Authorization": f"Bearer {token_b}"})

    assert response_a.json()["total"] == 4
    assert response_b.json()["total"] == 2
    a_resource_ids = {item["resource_id"] for item in response_a.json()["items"]}
    b_resource_ids = {item["resource_id"] for item in response_b.json()["items"]}
    assert a_resource_ids.isdisjoint(b_resource_ids)


async def test_audit_requires_authentication(client):
    response = await client.get("/v1/audit")
    assert response.status_code == 401


async def test_audit_ordering_is_deterministic_and_consistent_across_pages(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token = make_token(private_pem)
    await _ingest_many(client, token, "ministry-a", 6)

    page1 = await client.get("/v1/audit", params={"page": 1, "page_size": 3}, headers={"Authorization": f"Bearer {token}"})
    page2 = await client.get("/v1/audit", params={"page": 2, "page_size": 3}, headers={"Authorization": f"Bearer {token}"})

    ids_page1 = [item["id"] for item in page1.json()["items"]]
    ids_page2 = [item["id"] for item in page2.json()["items"]]
    assert set(ids_page1).isdisjoint(set(ids_page2))  # no overlap/duplication across pages

    # re-fetching the same page twice returns the same order (deterministic)
    page1_again = await client.get("/v1/audit", params={"page": 1, "page_size": 3}, headers={"Authorization": f"Bearer {token}"})
    assert [item["id"] for item in page1_again.json()["items"]] == ids_page1
