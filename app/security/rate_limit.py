"""In-memory per-caller rate limiting for /v1 routes."""

from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from threading import Lock
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status

from app.config import Settings, get_settings
from app.security.audit import AuditEventType, emit_audit
from app.security.auth import require_api_auth

_lock = Lock()
_buckets: dict[str, deque[float]] = defaultdict(deque)


def reset_rate_limit_state() -> None:
    """Test helper — clear all buckets."""
    with _lock:
        _buckets.clear()


def _prune(window: deque[float], now: float, window_seconds: float) -> None:
    cutoff = now - window_seconds
    while window and window[0] < cutoff:
        window.popleft()


def _rate_limit_disabled() -> bool:
    """Disable only via explicit env flag (bare limit=0 no longer kills limiting)."""
    return os.getenv("BUDGET_RATE_LIMIT_DISABLED", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


async def enforce_rate_limit(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    key_id: Annotated[str, Depends(require_api_auth)],
) -> str:
    """Sliding-window rate limit keyed by authenticated API key fingerprint."""
    if _rate_limit_disabled():
        return key_id

    # Treat <=0 as misconfig → fall back to default 60 (use env flag to disable).
    limit = settings.budget_rate_limit_per_minute
    if limit <= 0:
        limit = 60

    window_seconds = 60.0
    bucket_key = f"key:{key_id}"
    now = time.monotonic()
    correlation_id = getattr(request.state, "correlation_id", "unknown")

    with _lock:
        window = _buckets[bucket_key]
        _prune(window, now, window_seconds)
        if not window:
            _buckets.pop(bucket_key, None)
            window = _buckets[bucket_key]
        if len(window) >= limit:
            limited = True
        else:
            window.append(now)
            limited = False

    if limited:
        await emit_audit(
            AuditEventType.RATE_LIMITED,
            correlation_id=str(correlation_id),
            user_id=key_id,
            blocked=True,
            reason=f"rate_limit_{limit}_per_minute",
            metadata={"path": request.url.path},
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded ({limit} requests per minute)",
            headers={"Retry-After": "60"},
        )

    request.state.rate_limit_key = bucket_key
    return key_id
