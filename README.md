# Alte' Budgeting

Mobile-first personal budgeting PWA (YNAB-inspired) with Supabase Auth/Postgres.
PR quality gates from the governance stack stay in place.

| Piece | Path | Purpose |
|-------|------|---------|
| **Product app** | [`web/`](web/) | Alte' Budgeting (Next.js PWA) |
| **DB migrations** | [`supabase/migrations/`](supabase/migrations/) | Schema + RLS |
| **PR governance** | [`governance/`](governance/) | Automated Steps 1–5 on every PR |
| **Human review** | [`dashboard/`](dashboard/) | Approve / reject / merge findings |
| **CI hygiene** | [`.github/workflows/`](.github/workflows/) | Gitleaks, audits, CodeQL, Semgrep, builds |

> Operator steps for merge protection: [`SETUP_GOVERNANCE.md`](SETUP_GOVERNANCE.md)  
> Security checklist: [`SECURITY_OPERATOR_CHECKLIST.md`](SECURITY_OPERATOR_CHECKLIST.md)

## Product

- Multi-budget households with role / shared invite links (Settings)
- Budget screen (categories, assigned / activity / available)
- Accounts + transaction register
- Insights charts + rule-based trend tips
- YNAB register / Reflect **CSV import**
- Plaid bank sync (Link + transactions sync) + daily Vercel Cron
- Supabase Auth + budget-scoped RLS
- Installable PWA shell

## Quickstart — Alte' Budgeting (cloud only)

This app is meant to run on **Vercel**. Secrets live in **Doppler** and sync into Vercel — no local CLI, no `.env` files.

### 1. Supabase

1. Create a Supabase project
2. Run **all** SQL files in [`supabase/migrations/`](supabase/migrations/) in order in the SQL editor (including multi-budget + RLS grants). Skipping these causes logged-in pages to 500.
3. Enable Email auth (password) under Authentication → Providers

### 2. Doppler (source of truth for secrets)

1. Create Doppler project `alte-budgeting`
2. In configs `dev` / `preview` / `prd`, set the keys listed in [`web/doppler.secrets.example`](web/doppler.secrets.example):
   - Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Invites: `NEXT_PUBLIC_SITE_URL`
   - Cron / webhooks: `SUPABASE_SECRET_KEY` (`sb_secret_…` from Supabase → API Keys; preferred over legacy `service_role`), `CRON_SECRET`, `BANK_TOKEN_ENCRYPTION_KEY`
   - Plaid: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` (`sandbox` | `development` | `production`)
3. Doppler dashboard → **Integrations** → **Vercel**
4. Sync: `dev` → Development, `preview` → Preview, `prd` → Production

### 3. Vercel

1. Import this GitHub repo
2. Set **Root Directory** to `web`
3. Deploy — env vars arrive from the Doppler sync (do not paste secrets into Vercel by hand)
4. Cron: [`web/vercel.json`](web/vercel.json) hits `/api/cron/plaid-sync` daily at `15 12 * * *` UTC with `Authorization: Bearer CRON_SECRET` (Hobby allows one cron/day; on Pro you can restore morning+evening `15 0,12 * * *`)

Preview / production URLs come from Vercel after deploy.

### Plaid notes

- Keys: [Plaid Dashboard](https://dashboard.plaid.com) → Team Settings → Keys
- Start with `PLAID_ENV=sandbox` (Link test user `user_good` / `pass_good`)
- Settings → **Connect bank** opens Plaid Link; categories left blank for you to assign
- Run migration `supabase/migrations/20260724150000_plaid_bank_sync.sql`
- Disconnect / Sync now are available per connected item on Settings

### YNAB CSV import

1. In YNAB web: budget name → **Export Budget**
2. Upload the **Register** CSV on **Import** in Alte' Budgeting
3. Expected headers: `Account, Date, Payee, Category Group/Category, Memo, Outflow, Inflow`

## Governance (unchanged)

```bash
cd governance && pip install -e ".[dev]" && ai-guardrail run --root ..
```

Require status checks on `main`: **Governance Steps 1–5**, **Enterprise Layers B–E**, and **CodeQL (Layer C)**.

## Layout

```
web/            Alte' Budgeting Next.js PWA
supabase/       SQL migrations (RLS)
governance/     Steps 1–5 CLI + reporters
dashboard/      Human PR review panel
infra/terraform Checkov-scanned IaC stub
.github/        CI, Dependabot, CODEOWNERS
```
