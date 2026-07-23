"""API caller authentication (Bearer / X-API-Key).

Protects /v1 routes. Health stays public.
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings, get_settings
from app.correlation import parse_correlation_id
from app.security.audit import AuditEventType, emit_audit

_bearer = HTTPBearer(auto_error=False)


def _configured_keys(settings: Settings) -> frozenset[str]:
    keys: set[str] = set()
    if settings.budget_api_key.strip():
        keys.add(settings.budget_api_key.strip())
    for part in settings.budget_api_keys.split(","):
        cleaned = part.strip()
        if cleaned:
            keys.add(cleaned)
    return frozenset(keys)


def key_fingerprint(token: str) -> str:
    """Short opaque id for audit / rate-limit buckets (not password storage)."""
    return hashlib.pbkdf2_hmac(
        "sha256",
        token.encode("utf-8"),
        salt=b"budget-app-key-id-v1",
        iterations=10_000,
        dklen=8,
    ).hex()


def _constant_time_match(provided: str, allowed: frozenset[str]) -> bool:
    """Compare against every configured key (no early-exit on match)."""
    matched = False
    for key in allowed:
        if hmac.compare_digest(provided, key):
            matched = True
    return matched


def _correlation_id(request: Request) -> str:
    existing = getattr(request.state, "correlation_id", None)
    if isinstance(existing, str) and existing:
        return existing
    return parse_correlation_id(request.headers)


async def require_api_auth(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(_bearer),
    ] = None,
) -> str:
    """Require a valid API key. Returns a fingerprint for auditing."""
    correlation_id = _correlation_id(request)
    request.state.correlation_id = correlation_id

    allowed = _configured_keys(settings)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "API auth is not configured. Set BUDGET_API_KEY (or "
                "BUDGET_API_KEYS) before serving /v1 traffic."
            ),
        )

    token: str | None = None
    if credentials is not None and credentials.scheme.lower() == "bearer":
        token = credentials.credentials
    else:
        header_key = request.headers.get("x-api-key")
        if header_key:
            token = header_key.strip()

    if not token or not _constant_time_match(token, allowed):
        await emit_audit(
            AuditEventType.AUTH_DENIED,
            correlation_id=correlation_id,
            blocked=True,
            reason="invalid_or_missing_api_key",
            metadata={"path": request.url.path},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
            headers={"WWW-Authenticate": "Bearer"},
        )

    fingerprint = key_fingerprint(token)
    request.state.api_key_id = fingerprint
    return fingerprint
