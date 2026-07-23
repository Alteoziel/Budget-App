"""Auth + rate-limit contracts for /v1."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_accounts_require_auth(client: TestClient) -> None:
    resp = client.get("/v1/accounts")
    assert resp.status_code == 401


def test_accounts_with_bearer(client: TestClient) -> None:
    resp = client.get(
        "/v1/accounts",
        headers={"Authorization": "Bearer test-budget-key"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 0
    assert body["accounts"] == []


def test_create_account(client: TestClient) -> None:
    resp = client.post(
        "/v1/accounts",
        headers={"Authorization": "Bearer test-budget-key"},
        json={"name": "Checking", "currency": "usd", "balance_cents": 1500},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Checking"
    assert body["currency"] == "USD"
    assert body["balance_cents"] == 1500
    assert body["id"].startswith("acct_")
