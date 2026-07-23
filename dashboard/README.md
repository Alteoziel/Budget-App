# Budget App Governance Review Dashboard

Human review panel for Budget App pull requests. Receives reports from the
Python governance CLI (Steps 1–5: AST → Security → Fuzz → Bench → Copyright)
and can merge via GitHub’s REST API.

## Env

| Variable | Required | Purpose |
|----------|----------|---------|
| `GOVERNANCE_DASHBOARD_SECRET` | **Yes in prod** | CI ingest (`X-Governance-Secret`) |
| `GOVERNANCE_REVIEWER_SECRET` | Optional | Human approve/reject/merge (falls back to dashboard secret) |
| `GOVERNANCE_SITE_PASSWORD` | Recommended | Browser login gate |
| `UPSTASH_REDIS_REST_URL` | **Yes on Vercel** | Durable review store |
| `UPSTASH_REDIS_REST_TOKEN` | **Yes on Vercel** | Durable review store |
| `GITHUB_TOKEN` / `GH_MERGE_TOKEN` | Optional | Approve & Merge |
| `GITHUB_REPOSITORY` | Prod merge | Pin merge targets to `owner/name` |
| `GOVERNANCE_DASHBOARD_PUBLIC_URL` | Optional | Deep-link base URL |

On Vercel, add Upstash Redis (Marketplace → Storage) for durable reviews across lambdas.

## API

- `GET /api/reviews` — list reviews
- `POST /api/reviews` — CI ingest
- `GET /api/reviews/:id` — single review
- `POST /api/reviews/:id` — `{ "action": "approve" | "reject" | "merge" }`
- `GET /api/health` / `GET /api/status` — readiness

## Local

```bash
cp .env.example .env.local
npm ci
npm run dev
```
