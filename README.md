# Budget App

Clean-slate personal budgeting API with the same enterprise security stack
carried over from a prior project — **minus the comprehension quiz**.

> **Security operator steps** (secrets, Protect Main, FOSSA/Snyk):  
> [`SECURITY_OPERATOR_CHECKLIST.md`](SECURITY_OPERATOR_CHECKLIST.md)

## Pre-merge gates

| Gate | Path |
|------|------|
| Governance Steps 1–5 (AST → OWASP → Fuzz → Big-O → Copyright) | [`governance/`](governance/) + [`.github/workflows/ai-guardrail.yml`](.github/workflows/ai-guardrail.yml) |
| Human review dashboard (approve / reject / merge) | [`dashboard/`](dashboard/) |
| Enterprise Layers B–E | [`ENTERPRISE_LAYERS.md`](ENTERPRISE_LAYERS.md) + [`.github/workflows/enterprise-hygiene.yml`](.github/workflows/enterprise-hygiene.yml) |
| CodeQL (Layer C) | [`.github/workflows/codeql.yml`](.github/workflows/codeql.yml) |

```bash
cd governance && pip install -e ".[dev]" && ai-guardrail run --root ..
```

Require status checks on `main`: **`Governance Steps 1–5`**, **`Enterprise Layers B–E`**, and **`CodeQL (Layer C)`**.

## What’s in the box

- FastAPI Budget App scaffold (`/health`, authenticated `/v1/accounts` stub)
- API key auth, sliding-window rate limits, audit sink, deny-by-default egress HTTP client
- Governance engine (no quiz), review dashboard (no quiz), Dependabot, Gitleaks, Semgrep, CodeQL, FOSSA, Trivy, Checkov

## Quickstart

```bash
cp .env.example .env
# Set BUDGET_API_KEY to a long random string

python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
# Or: curl -LsSf https://astral.sh/uv/install.sh | sh && uv sync --frozen --extra dev

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

```bash
curl http://localhost:8000/health
curl -H "Authorization: Bearer $BUDGET_API_KEY" http://localhost:8000/v1/accounts
```

## Docker

```bash
docker compose up --build
```

## Layout

```
app/            Budget App API + security modules
governance/     Steps 1–5 CLI + reporters
dashboard/      Human review panel (Next.js)
tests/          API + security contracts
infra/terraform Checkov-scanned IaC stub
.github/        CI, Dependabot, CODEOWNERS
```
