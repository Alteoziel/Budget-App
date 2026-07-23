"""Security layer unit contracts (egress, audit, auth fingerprint)."""

from __future__ import annotations

import pytest
from app.security.auth import key_fingerprint
from app.security.egress import (
    ALLOWED_HOSTS,
    EgressDeniedError,
    assert_allowed_url,
    is_allowed_url,
)


def test_key_fingerprint_stable() -> None:
    a = key_fingerprint("test-budget-key")
    b = key_fingerprint("test-budget-key")
    assert a == b
    assert len(a) == 16


def test_egress_deny_by_default() -> None:
    assert ALLOWED_HOSTS == frozenset()
    assert is_allowed_url("https://api.openai.com/v1") is False
    assert is_allowed_url("http://example.com") is False
    with pytest.raises(EgressDeniedError):
        assert_allowed_url("https://evil.example/exfil")
