"""Layer E — security package exports."""

from app.security.audit import (
    AuditEvent,
    AuditEventType,
    InMemoryAuditSink,
    emit_audit,
    get_audit_sink,
)
from app.security.auth import require_api_auth
from app.security.egress import (
    ALLOWED_HOSTS,
    EgressDeniedError,
    assert_allowed_host,
    assert_allowed_url,
    is_allowed_url,
)
from app.security.http import EgressCheckedAsyncClient
from app.security.rate_limit import enforce_rate_limit

__all__ = [
    "ALLOWED_HOSTS",
    "AuditEvent",
    "AuditEventType",
    "EgressCheckedAsyncClient",
    "EgressDeniedError",
    "InMemoryAuditSink",
    "assert_allowed_host",
    "assert_allowed_url",
    "emit_audit",
    "enforce_rate_limit",
    "get_audit_sink",
    "is_allowed_url",
    "require_api_auth",
]
