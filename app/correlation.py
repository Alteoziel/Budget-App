"""Request correlation IDs for audit / log tracing."""

from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import UTC, datetime
from uuid import uuid4

CORRELATION_ID_HEADER = "X-Correlation-ID"
_CORRELATION_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


def generate_correlation_id() -> str:
    return f"corr_{uuid4().hex}"


def parse_correlation_id(headers: Mapping[str, str] | None) -> str:
    if headers is None or not isinstance(headers, Mapping):
        return generate_correlation_id()

    raw_value = headers.get(CORRELATION_ID_HEADER)
    if raw_value is None:
        for key, value in headers.items():
            if key.lower() == CORRELATION_ID_HEADER.lower():
                raw_value = value
                break

    if raw_value is None:
        return generate_correlation_id()

    correlation_id = raw_value.strip()
    if _CORRELATION_ID_PATTERN.fullmatch(correlation_id):
        return correlation_id

    return generate_correlation_id()


def received_at_iso() -> str:
    return datetime.now(UTC).isoformat()
