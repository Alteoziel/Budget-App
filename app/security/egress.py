"""Layer E — deny-by-default egress allowlist for outbound HTTPS calls.

Populate ALLOWED_EGRESS as integrations are added (banks, Plaid, Stripe, etc.).
Until then the allowlist is empty — outbound calls must fail closed.
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse


@dataclass(frozen=True, slots=True)
class EgressTarget:
    name: str
    host: str
    scheme: str = "https"


# Empty by default: budget features that need egress must opt in explicitly.
ALLOWED_EGRESS: tuple[EgressTarget, ...] = ()

ALLOWED_HOSTS: frozenset[str] = frozenset(t.host.lower() for t in ALLOWED_EGRESS)


class EgressDeniedError(PermissionError):
    """Raised when an outbound URL is not on the allowlist."""


def is_allowed_url(url: object) -> bool:
    """Return True if URL host is on the egress allowlist and uses https.

    Non-string inputs are rejected (False) rather than crashing — callers and
    the fuzz chamber both expect deny-by-default without AttributeError.
    """
    if not isinstance(url, str):
        return False
    parsed = urlparse(url)
    if parsed.scheme != "https":
        return False
    host = (parsed.hostname or "").lower()
    return host in ALLOWED_HOSTS


def assert_allowed_url(url: object) -> None:
    if not isinstance(url, str):
        raise TypeError(f"url must be str, got {type(url).__name__}")
    if not is_allowed_url(url):
        raise EgressDeniedError(
            f"Egress denied for URL host (not on allowlist): {url!r}. "
            f"Allowed hosts: {sorted(ALLOWED_HOSTS)}"
        )


def assert_allowed_host(host: object) -> None:
    if not isinstance(host, str):
        raise TypeError(f"host must be str, got {type(host).__name__}")
    normalized = host.lower().strip()
    if normalized not in ALLOWED_HOSTS:
        raise EgressDeniedError(
            f"Egress denied for host {host!r}. Allowed: {sorted(ALLOWED_HOSTS)}"
        )
