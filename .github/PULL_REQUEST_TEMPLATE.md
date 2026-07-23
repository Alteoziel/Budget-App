## Summary

<!-- What does this PR change and why? -->

## Checklist

- [ ] New `/v1` routes use `require_api_auth` / `enforce_rate_limit`
- [ ] Rate limiting considered
- [ ] Audit events emitted for deny/allow paths
- [ ] No new dependency without lockfile update
- [ ] Tests for authz-denied and malformed input
- [ ] Outbound HTTP uses `EgressCheckedAsyncClient` (no bare httpx)
