from gov_platform.models import ClassificationLevel, TenantContext
from gov_platform.security import evaluate_abac


def test_abac_rejects_cross_tenant_access():
    decision = evaluate_abac(
        TenantContext(tenant_id="ministry-a", ministry="A", roles={"case-reviewer"}),
        "document:read",
        "ministry-b",
        ClassificationLevel.internal,
        "case-review",
    )

    assert decision.allowed is False
    assert decision.reason == "tenant_mismatch"


def test_abac_allows_protected_b_with_role():
    decision = evaluate_abac(
        TenantContext(tenant_id="ministry-a", ministry="A", roles={"protected-b-reader"}),
        "document:read",
        "ministry-a",
        ClassificationLevel.protected_b,
        "legal-review",
    )

    assert decision.allowed is True

