import hashlib

from tests.conftest import make_token


async def _ingest(client, token, tenant, filename, content, content_type="application/pdf"):
    sha256 = hashlib.sha256(content).hexdigest()
    response = await client.post(
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
    return response.json()["id"], sha256


async def test_upload_then_download_roundtrip(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token = make_token(private_pem)
    content = b"%PDF-1.4 fake pdf content for round-trip test"
    doc_id, _ = await _ingest(client, token, "ministry-a", "roundtrip.pdf", content)

    upload = await client.put(
        f"/v1/documents/{doc_id}/content", headers={"Authorization": f"Bearer {token}"}, content=content
    )
    assert upload.status_code == 200
    assert upload.json()["bytes_stored"] == len(content)

    download = await client.get(f"/v1/documents/{doc_id}/download", headers={"Authorization": f"Bearer {token}"})
    assert download.status_code == 200
    assert download.content == content
    assert download.headers["content-type"] == "application/pdf"
    assert 'filename="roundtrip.pdf"' in download.headers["content-disposition"]


async def test_upload_rejects_sha256_mismatch(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token = make_token(private_pem)
    doc_id, _ = await _ingest(client, token, "ministry-a", "integrity.pdf", b"original bytes")

    tampered = await client.put(
        f"/v1/documents/{doc_id}/content",
        headers={"Authorization": f"Bearer {token}"},
        content=b"these are NOT the original bytes",
    )
    assert tampered.status_code == 422
    assert tampered.json()["detail"] == "sha256_mismatch"


async def test_download_before_upload_returns_404(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token = make_token(private_pem)
    doc_id, _ = await _ingest(client, token, "ministry-a", "never_uploaded.pdf", b"metadata only")

    download = await client.get(f"/v1/documents/{doc_id}/download", headers={"Authorization": f"Bearer {token}"})
    assert download.status_code == 404
    assert download.json()["detail"] == "document_content_not_uploaded"


async def test_download_nonexistent_document_id_returns_404(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token = make_token(private_pem)
    fake_id = "99999999-9999-9999-9999-999999999999"
    download = await client.get(f"/v1/documents/{fake_id}/download", headers={"Authorization": f"Bearer {token}"})
    assert download.status_code == 404
    assert download.json()["detail"] == "document_not_found"


async def test_cross_tenant_download_forbidden(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token_a = make_token(private_pem, tenant_id="ministry-a")
    token_b = make_token(private_pem, tenant_id="ministry-b")
    content = b"ministry A eyes only"
    doc_id, _ = await _ingest(client, token_a, "ministry-a", "secret.pdf", content)
    await client.put(f"/v1/documents/{doc_id}/content", headers={"Authorization": f"Bearer {token_a}"}, content=content)

    download = await client.get(f"/v1/documents/{doc_id}/download", headers={"Authorization": f"Bearer {token_b}"})
    assert download.status_code == 403
    assert download.json()["detail"] == "tenant_mismatch"


async def test_cross_tenant_upload_forbidden(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token_a = make_token(private_pem, tenant_id="ministry-a")
    token_b = make_token(private_pem, tenant_id="ministry-b")
    content = b"attacker-controlled bytes"
    doc_id, _sha = await _ingest(client, token_a, "ministry-a", "target.pdf", content)

    upload = await client.put(
        f"/v1/documents/{doc_id}/content", headers={"Authorization": f"Bearer {token_b}"}, content=content
    )
    assert upload.status_code == 403


async def test_download_requires_authentication(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token = make_token(private_pem)
    content = b"needs auth to fetch"
    doc_id, _ = await _ingest(client, token, "ministry-a", "auth_needed.pdf", content)
    await client.put(f"/v1/documents/{doc_id}/content", headers={"Authorization": f"Bearer {token}"}, content=content)

    download = await client.get(f"/v1/documents/{doc_id}/download")
    assert download.status_code == 401


async def test_upload_rejects_empty_body(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token = make_token(private_pem)
    doc_id, _ = await _ingest(client, token, "ministry-a", "empty.pdf", b"x")

    upload = await client.put(f"/v1/documents/{doc_id}/content", headers={"Authorization": f"Bearer {token}"}, content=b"")
    assert upload.status_code == 422
    assert upload.json()["detail"] == "empty_upload_body"


async def test_storage_key_never_derived_from_client_object_uri():
    """Regression test: the storage key must be derived only from
    (tenant_id, document_id), never from the client-supplied object_uri
    field, to close off path-traversal / cross-tenant-overwrite abuse."""
    from gov_platform.storage import storage_key

    key = storage_key("ministry-a", "11111111-1111-1111-1111-111111111111")
    assert "../" not in key
    assert key == "ministry-a/11111111-1111-1111-1111-111111111111"


async def test_download_streams_large_file(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token = make_token(private_pem)
    large_content = b"X" * (5 * 1024 * 1024)  # 5 MB
    doc_id, _ = await _ingest(client, token, "ministry-a", "large_file.bin", large_content, content_type="application/octet-stream")

    upload = await client.put(f"/v1/documents/{doc_id}/content", headers={"Authorization": f"Bearer {token}"}, content=large_content)
    assert upload.status_code == 200

    download = await client.get(f"/v1/documents/{doc_id}/download", headers={"Authorization": f"Bearer {token}"})
    assert download.status_code == 200
    assert len(download.content) == len(large_content)
    assert download.content == large_content


async def test_upload_rejects_oversized_body(client, patched_auth, rsa_keys, monkeypatch):
    import gov_platform.main as main_module

    monkeypatch.setattr(main_module, "MAX_UPLOAD_BYTES", 10)  # tiny cap for the test
    private_pem, _ = rsa_keys
    token = make_token(private_pem)
    content = b"this is more than ten bytes"
    doc_id, _ = await _ingest(client, token, "ministry-a", "too_big.pdf", content)

    upload = await client.put(f"/v1/documents/{doc_id}/content", headers={"Authorization": f"Bearer {token}"}, content=content)
    assert upload.status_code == 413
    assert upload.json()["detail"] == "upload_too_large"


async def test_download_content_disposition_handles_adversarial_filename(client, patched_auth, rsa_keys):
    """A filename containing CRLF or quote characters must never be able to
    inject additional headers or break out of the Content-Disposition value."""
    private_pem, _ = rsa_keys
    token = make_token(private_pem)
    adversarial_name = 'evil"\r\nX-Injected: true\r\n.pdf'
    content = b"adversarial filename test"
    sha256 = hashlib.sha256(content).hexdigest()

    ingest = await client.post(
        "/v1/documents",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "tenant_id": "ministry-a",
            "filename": adversarial_name,
            "content_type": "application/pdf",
            "sha256": sha256,
            "object_uri": "s3://x/adversarial.pdf",
        },
    )
    doc_id = ingest.json()["id"]
    await client.put(f"/v1/documents/{doc_id}/content", headers={"Authorization": f"Bearer {token}"}, content=content)

    download = await client.get(f"/v1/documents/{doc_id}/download", headers={"Authorization": f"Bearer {token}"})
    assert download.status_code == 200
    assert "x-injected" not in {h.lower() for h in download.headers}
    disposition = download.headers["content-disposition"]
    assert "\r" not in disposition and "\n" not in disposition


async def test_download_content_disposition_handles_unicode_filename(client, patched_auth, rsa_keys):
    private_pem, _ = rsa_keys
    token = make_token(private_pem)
    unicode_name = "rapport_évaluation_环境.pdf"
    content = b"unicode filename test"
    sha256 = hashlib.sha256(content).hexdigest()

    ingest = await client.post(
        "/v1/documents",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "tenant_id": "ministry-a",
            "filename": unicode_name,
            "content_type": "application/pdf",
            "sha256": sha256,
            "object_uri": "s3://x/unicode.pdf",
        },
    )
    doc_id = ingest.json()["id"]
    await client.put(f"/v1/documents/{doc_id}/content", headers={"Authorization": f"Bearer {token}"}, content=content)

    download = await client.get(f"/v1/documents/{doc_id}/download", headers={"Authorization": f"Bearer {token}"})
    assert download.status_code == 200
    assert "filename*=UTF-8''" in download.headers["content-disposition"]
