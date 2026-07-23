# What You Need To Do — Governance Gate (Budget App)

The five-step suite is in the repo. **It will not protect `main` until you finish these setup steps.**

## Mental model

| Thing | Where it runs | What you do with it |
|-------|---------------|---------------------|
| **Governance Steps 1–5** | GitHub Actions (`AI Code Guardrail` workflow) | Automated AST / OWASP / fuzz / Big-O / copyright on every PR |
| **Human Review Dashboard** | **Vercel** (`dashboard/` Next.js app) | Approve / reject / merge after reviewing findings |
| **Budget App API** | Docker / your host — **not Vercel** | The product API (`app/`) |

There is **no comprehension quiz** in this repository.

---

## 1. Merge the clean-slate PR

Bring `governance/`, `.github/workflows/ai-guardrail.yml`, `dashboard/`, and the Budget App scaffold onto `main`.

## 2. Require the CI checks

GitHub → **Settings → Branches / Rulesets** → protect `main`:

1. Require a pull request before merging
2. Require status checks to pass → select:
   - **`Governance Steps 1–5`**
   - **`Enterprise Layers B–E`**
   - **`CodeQL (Layer C)`**
3. Optionally keep Vercel + Bugbot required as well

## 3. (Optional) Enable LLM enrichment (Step 2)

Repo → **Settings → Secrets and variables → Actions**:

| Secret | Value |
|--------|-------|
| `OPENAI_API_KEY` or `GOVERNANCE_LLM_API_KEY` | Your API key |

Optional variable: `GOVERNANCE_LLM_MODEL` (default `gpt-4o-mini`).

Without this, Step 2 still runs deterministic OWASP regex rules.

## 4. Deploy the review dashboard to Vercel

### 4a. Create a secret you will reuse

Pick a long random string (`openssl rand -hex 32`). Paste it in:

1. Vercel env → `GOVERNANCE_DASHBOARD_SECRET`
2. GitHub Actions secret → `GOVERNANCE_DASHBOARD_SECRET` (same value)
3. Browser “Unlock actions” prompt when reviewing

### 4b. Create a Vercel project for the dashboard

1. Open [vercel.com/new](https://vercel.com/new)
2. **Import** `Alteoziel/Budget-App`
3. Project name: e.g. `budget-app-governance`
4. **Root Directory** → **`dashboard`**
5. Framework Preset: **Next.js**
6. **Output Directory** must be empty / default
7. Add env + Redis (next steps), then deploy

### 4c. Add Upstash Redis (required on Vercel)

1. Vercel project → **Storage** → **Create** → **Upstash Redis**
2. Connect it — Vercel injects `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
3. Redeploy after connecting

### 4d. Set dashboard environment variables

| Env | Value |
|-----|-------|
| `GOVERNANCE_DASHBOARD_SECRET` | Secret from 4a |
| `GOVERNANCE_SITE_PASSWORD` | **Recommended.** Browser login password |
| `GOVERNANCE_REVIEWER_SECRET` | Optional; defaults to dashboard secret |
| `GITHUB_TOKEN` or `GH_MERGE_TOKEN` | Fine-grained PAT with `contents:write` + `pull-requests:write` (for **Approve & Merge**) |
| `GITHUB_REPOSITORY` | `Alteoziel/Budget-App` (pins merge targets) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | From Marketplace |

### 4e. Wire CI → dashboard

GitHub → **Settings → Secrets and variables → Actions**:

| Secret | Value |
|--------|-------|
| `GOVERNANCE_DASHBOARD_URL` | Vercel production URL (no trailing slash), e.g. `https://budget-app-governance.vercel.app` |
| `GOVERNANCE_DASHBOARD_SECRET` | Same as Vercel |

## 5. Budget App API secrets

For local / hosted API:

| Env | Purpose |
|-----|---------|
| `BUDGET_API_KEY` | Required for `/v1` routes |
| `BUDGET_RATE_LIMIT_PER_MINUTE` | Optional (default 60) |

Never commit real keys. Use `.env` (gitignored) or host secrets.

## 6. Confirm the loop

1. Open a PR that touches `app/` or `governance/`
2. Wait for **Governance Steps 1–5** to go green
3. Open the dashboard — a new review should appear
4. Unlock with the reviewer secret → Approve / Reject / Merge

If the dashboard stays empty: check Actions logs for dashboard POST failures (401 = mismatched secret).
