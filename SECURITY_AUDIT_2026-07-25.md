# Security audit — 2026-07-25

Scope: all tracked application, dashboard, Supabase migration, governance, and
GitHub Actions code on `main`. Threat model assumes clients can alter every
payload, URL, cookie, browser state value, and unsigned JWT claim.

## Patched checkpoints

1. Enforced an absolute 14-day primary-sign-in window on pages, server actions,
   APIs, and offline caches.
2. Removed arbitrary self-enrollment as a budget owner; owner bootstrap is now
   limited to a newly created budget owned by the authenticated user.
3. Enforced owner/admin hierarchy for memberships and invites, including
   serialized last-owner protection.
4. Added same-budget foreign keys, RLS, and runtime filters for Plaid/Teller
   item-to-account mappings.
5. Added same-budget constraints and runtime validation for transaction-match
   suggestions.
6. Aggregated and conserved overspend donations/allocations and serialized
   fixes per budget/month.
7. Added Plaid ES256 webhook JWT, key, freshness, and raw-body hash validation
   before service-role access.
8. Removed authenticated access to unscoped sync logs and global change-log
   purge.
9. Replaced the forgeable password-reset flag with a signed, user-bound,
   expiring grant and signed recovery state.
10. Partitioned offline data by user/budget, made replay idempotent, purged
    private caches on sign-out/login, and bound offline expiry to reauth time.
11. Made Realtime Presence/Broadcast private and membership-authorized.
12. Separated dashboard ingest credentials from reviewer/merge credentials.
13. Bound dashboard merges to the reviewed full SHA, repository, and `main`.
14. Bounded and validated governance report ingestion and rendering.
15. Replaced spoofable/unbounded dashboard login buckets with Redis-backed,
    trusted-IP fixed windows and a bounded fallback.
16. Added same-origin validation to dashboard logout.
17. Made dashboard review transitions atomic and reserved merge state before
    GitHub I/O.
18. Changed PR governance to run a trusted base-branch engine against the
    candidate as data, with read-only permissions and no secrets. Kept the
    trigger on `pull_request` so required check contexts continue to report
    (switching to `pull_request_target` before merging left checks stuck as
    "Expected — Waiting for status to be reported" because main still had the
    old workflow definitions).
19. Made full-tree governance scans use fail-closed, NUL-safe tracked-file
    enumeration; added an explicit route-auth gate and false-positive tests.
20. Kept the required "FOSSA License Scan" check on `pull_request`. GitHub
    Dependency Review is unavailable here without Advanced Security, so the
    workflow uses FOSSA when `FOSSA_API_KEY` is set and otherwise a
    fail-closed secretless package-manifest denied-license gate.

## Endpoint permission inventory

| Endpoint | Method | Explicit permission boundary |
|---|---|---|
| `/auth/callback` | GET | One-time Supabase code/OTP; signed recovery state for password grants |
| `/api/cron/plaid-sync` | GET/POST | Timing-safe `CRON_SECRET` bearer |
| `/api/plaid/webhook` | POST | Plaid ES256 JWT + 5-minute age + raw-body SHA-256 |
| `/api/plaid/link-token` | POST | Fresh Supabase user + active-budget admin |
| `/api/plaid/exchange` | POST | Fresh Supabase user + active-budget admin |
| `/api/offline/snapshot` | GET | Fresh Supabase user + active-budget viewer |
| `/api/offline/sync` | POST | Fresh Supabase user + active-budget editor + user/budget-bound items |
| Dashboard `/api/health` | GET | Intentionally public; fixed `{ok:true}` only |
| Dashboard `/api/auth/login` | POST | Rate-limited site-password verification |
| Dashboard `/api/auth/logout` | POST | Same-origin browser request |
| Dashboard `/api/reviews` | GET | Site session, ingest secret, or distinct reviewer secret |
| Dashboard `/api/reviews` | POST | Ingest secret only |
| Dashboard `/api/reviews/:id` | GET | Site session, ingest secret, or distinct reviewer secret |
| Dashboard `/api/reviews/:id` | POST | Distinct reviewer secret only |
| Dashboard `/api/status` | GET | Authorized review read |

All 48 product server actions were also traced. Public actions are limited to
sign-in, sign-up, and sign-out. User-only actions call `requireUser`; all
budget reads/mutations call `requireBudget` with viewer/editor/admin/owner
minimum roles and scope client-supplied entity IDs to the active budget.

No production endpoint remains without either an explicit permission check or
an intentional, documented public trust boundary.

## Deployment checklist

- Apply `supabase/migrations/20260725190000_security_authorization_hardening.sql`
  **and** `supabase/migrations/20260726010000_publish_security_fixes.sql`
  (Supabase SQL editor or CLI). The hardening migration is the July 25 authz
  pass; the publish-fixes migration closes invite-hash escalation, auth-delete
  cascades, and bank-token column reads.
- Set dedicated random `APP_SECURITY_SECRET` and `BANK_TOKEN_ENCRYPTION_KEY`
  in Doppler/Vercel (no shared fallbacks).
- Set `GOVERNANCE_REVIEWER_SECRET` to a value different from
  `GOVERNANCE_DASHBOARD_SECRET`.
- In Supabase Realtime settings, disable **Allow public access** after deploying
  the private-channel policies. The save warning that all clients will
  disconnect is expected and OK — browsers reconnect; the app already uses
  `private: true` channels, and the hardening migration creates the
  `realtime.messages` RLS policies (`can_access_budget_realtime_topic`). Do not
  hand-create extra policies unless that migration has not been applied.
- In GitHub Protect Main, require **`CodeQL (Layer C)`** in addition to FOSSA,
  Enterprise Layers B–E, and Governance Steps 1–5.

## Deferred because they can affect functionality or require platform changes

- Automated PR comments/dashboard ingestion were removed from the untrusted
  scanner job. Restore them only through a trusted `workflow_run` reporter that
  validates the source run, PR, repository, and head SHA before using secrets.
- Enable GitHub Dependency graph + Advanced Security, then switch the FOSSA
  required check to pinned Dependency Review. Until then, keep `FOSSA_API_KEY`
  set for full transitive license SCA; the secretless manifest gate is only a
  same-repo fallback.
- Overspend writes are now input-safe and concurrency-serialized, but a future
  SQL RPC should make the multi-row operation fully atomic against infrastructure
  failures.
- Production CSP uses per-request script nonces + `'strict-dynamic'` (no
  `'unsafe-inline'` / `'unsafe-eval'` on scripts). `style-src` still allows
  `'unsafe-inline'` for React style attributes.
