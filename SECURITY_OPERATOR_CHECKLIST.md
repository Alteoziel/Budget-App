# Security operator checklist (human steps)

This list is for a **non-expert human operator**. Code and CI automate a lot; these items need **you** (clicks, accounts, or secrets that must never be committed).

**Legend**

- **DONE IN REPO** — already wired in this repository; you only confirm or maintain.
- **YOU MUST DO THIS** — cannot be finished by code alone; you take the action.

## Master status

| Item | Status | Where / what you do |
|------|--------|---------------------|
| Alte' Budgeting app (`web/`) | **DONE IN REPO** | Deploy to Vercel; Root Directory `web` |
| Supabase Auth + RLS schema | **DONE IN REPO** | **YOU** create project, run migration (§5) |
| Doppler secrets for `web/` | **YOU MUST DO THIS** | Create project secrets + sync to Vercel (§5) |
| Governance Steps 1–5 (no quiz) | **DONE IN REPO** | Require check on Protect Main (§3) |
| Enterprise Layers B–E + CodeQL | **DONE IN REPO** | Require checks on Protect Main (§3) |
| Secret scanning + push protection | **YOU MUST DO THIS** | §1 (confirm enabled) |
| Pre-commit (ruff + gitleaks) | **DONE IN REPO** | Optional local install §4 |
| FOSSA license SCA workflow | **DONE IN REPO** (needs secret) | **YOU** create FOSSA account + `FOSSA_API_KEY` (§2) |
| PR checklist template | **DONE IN REPO** | Fill checkboxes on every PR |
| Semgrep custom + OWASP packs | **DONE IN REPO** | Nothing |
| Review dashboard deploy | **YOU MUST DO THIS** | See `SETUP_GOVERNANCE.md` |
| Copyright signature DB | **DONE IN REPO** | Optionally add more snippets later |

---

## 1. Verify GitHub Secret scanning + Push protection

**YOU MUST DO THIS** (confirm — it may already be on).

1. Open the GitHub repository → **Settings** → **Code security**.
2. Enable **Secret scanning**.
3. Enable **Push protection**.
4. Confirm **Dependabot alerts** (+ security updates) are on.

- [ ] Secret scanning confirmed enabled
- [ ] Push protection confirmed enabled

---

## 2. FOSSA account + `FOSSA_API_KEY` GitHub secret

**YOU MUST DO THIS** for the account/token.  
**DONE IN REPO:** [`.github/workflows/fossa-license.yml`](.github/workflows/fossa-license.yml).

1. Create a [FOSSA](https://fossa.com) account and copy an API token.
2. GitHub → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
3. Name: `FOSSA_API_KEY` → paste token.

Alternative: use Snyk with your own workflow if preferred.

- [ ] `FOSSA_API_KEY` set (or Snyk alternative configured)

---

## 3. Protect `main` ruleset

**YOU MUST DO THIS** in GitHub settings (repo already has the workflows).

Require:

1. Pull request before merge
2. Status checks: **`Governance Steps 1–5`**, **`Enterprise Layers B–E`**, **`CodeQL (Layer C)`**
3. Code Owner review
4. Dismiss stale approvals
5. Up-to-date branch before merge
6. Signed commits (recommended)
7. No force-push / no delete on default branch

Do **not** require a **Governance Quiz** check — that gate exists only in the other repository.

- [ ] Protect Main ruleset configured without quiz

---

## 4. Local pre-commit (optional)

```bash
pip install pre-commit
pre-commit install
pre-commit run --all-files
```

---

## 5. Runtime secrets for Alte' Budgeting (`web/`) — Doppler (cloud only)

Manage secrets in the **Doppler dashboard** and sync them to **Vercel**. No local CLI, no `.env` files.

| Secret | Required | Notes |
|--------|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Publishable anon key (RLS enforced) |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Server-only if needed later; never ship to client |

Flow: Doppler dashboard → set secrets → **Integrations → Vercel** (`dev` / `preview` / `prd`).  
Key list: [`web/doppler.secrets.example`](web/doppler.secrets.example).

- [ ] Supabase migration applied (RLS on)
- [ ] Doppler project + secrets created in the dashboard
- [ ] Doppler → Vercel sync configured for Development / Preview / Production
- [ ] Vercel project Root Directory = `web`

---

## 6. Governance dashboard

Follow [`SETUP_GOVERNANCE.md`](SETUP_GOVERNANCE.md) for Vercel + Upstash + CI secrets.

- [ ] Dashboard deployed
- [ ] `GOVERNANCE_DASHBOARD_URL` + `GOVERNANCE_DASHBOARD_SECRET` match between Actions and Vercel
