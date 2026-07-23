"""Shared pytest fixtures for the Budget App API."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

# Configure auth before app import side-effects matter for settings cache.
os.environ.setdefault("BUDGET_API_KEY", "test-budget-key")


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("BUDGET_API_KEY", "test-budget-key")
    from app.config import clear_settings_cache
    from app.main import create_app
    from app.security.rate_limit import reset_rate_limit_state

    clear_settings_cache()
    reset_rate_limit_state()
    # Reset in-memory accounts between tests
    import app.api.v1.accounts as accounts_mod

    accounts_mod._ACCOUNTS.clear()
    accounts_mod._NEXT_ID = 1

    with TestClient(create_app()) as test_client:
        yield test_client

    clear_settings_cache()
    reset_rate_limit_state()
