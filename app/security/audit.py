"""Layer E — audit log schema + process-wide sink (swap later for Postgres).

In-memory sink is wired on the request path now so future code always has an
audit hook. Production can swap the sink implementation without changing call
sites.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from threading import Lock
from typing import Any, Protocol
from uuid import uuid4

from pydantic import BaseModel, Field


class AuditEventType(StrEnum):
    REQUEST_RECEIVED = "request_received"
    AUTH_OK = "auth_ok"
    AUTH_DENIED = "auth_denied"
    RATE_LIMITED = "rate_limited"
    EGRESS_DENIED = "egress_denied"
    TXN_CREATED = "txn_created"
    TXN_UPDATED = "txn_updated"
    ACCOUNT_CREATED = "account_created"


class AuditEvent(BaseModel):
    """Immutable-ish audit record for a single API decision/action."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    ts: datetime = Field(default_factory=lambda: datetime.now(UTC))
    event_type: AuditEventType
    correlation_id: str
    user_id: str | None = None
    blocked: bool = False
    reason: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


# Suggested Postgres DDL — keep in sync with AuditEvent fields.
AUDIT_EVENTS_DDL = """
CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    event_type TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    user_id TEXT,
    blocked BOOLEAN NOT NULL DEFAULT FALSE,
    reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_audit_events_ts ON audit_events (ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_correlation ON audit_events (correlation_id);
"""


class AuditSink(Protocol):
    async def write(self, event: AuditEvent) -> AuditEvent: ...


class InMemoryAuditSink:
    """Dev/test sink until a durable store is wired."""

    def __init__(self, *, maxlen: int = 10_000) -> None:
        self.events: list[AuditEvent] = []
        self._maxlen = maxlen
        self._lock = Lock()

    async def write(self, event: AuditEvent) -> AuditEvent:
        with self._lock:
            self.events.append(event)
            if len(self.events) > self._maxlen:
                overflow = len(self.events) - self._maxlen
                del self.events[:overflow]
        return event

    def clear(self) -> None:
        with self._lock:
            self.events.clear()


_sink: InMemoryAuditSink = InMemoryAuditSink()


def get_audit_sink() -> InMemoryAuditSink:
    return _sink


def set_audit_sink(sink: InMemoryAuditSink) -> None:
    """Replace process sink (tests)."""
    global _sink
    _sink = sink


async def emit_audit(
    event_type: AuditEventType,
    *,
    correlation_id: str,
    blocked: bool = False,
    reason: str | None = None,
    user_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> AuditEvent:
    event = AuditEvent(
        event_type=event_type,
        correlation_id=correlation_id or "unknown",
        blocked=blocked,
        reason=reason,
        user_id=user_id,
        metadata=metadata or {},
    )
    return await get_audit_sink().write(event)
