"""Egress-enforcing HTTP client — all outbound calls must use this."""

from __future__ import annotations

from typing import Any

import httpx

from app.security.egress import assert_allowed_url


class EgressCheckedAsyncClient(httpx.AsyncClient):
    """httpx.AsyncClient that deny-by-default checks every request URL.

    Application code must not create bare httpx clients. This central choke
    point prevents accidental SSRF / data exfil if a new URL is introduced.
    """

    async def request(self, method: str, url: httpx.URL | str, **kwargs: Any) -> httpx.Response:
        assert_allowed_url(str(url))
        return await super().request(method, url, **kwargs)

    async def send(self, request: httpx.Request, **kwargs: Any) -> httpx.Response:
        assert_allowed_url(str(request.url))
        return await super().send(request, **kwargs)
