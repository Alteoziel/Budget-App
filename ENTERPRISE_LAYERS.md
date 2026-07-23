# Enterprise Layers B–E

Automated supply-chain, SAST, product builds, and IaC checks.
These sit **beside** Governance Steps 1–5 (AI Code Guardrail).

| Layer | What | Where |
|-------|------|-------|
| **B** Supply chain & secrets | Dependabot, checksummed Gitleaks, pip-audit (governance), npm audit (dashboard + web) | `.github/dependabot.yml`, `.gitleaks.toml`, CI job |
| **C** Static analysis | ESLint + `tsc` (web), Semgrep, CodeQL Advanced, CODEOWNERS | `web/`, `.semgrep.yml`, `.github/workflows/codeql.yml`, CI |
| **D** Product builds | Next.js production builds for `web/` and `dashboard/` | CI |
| **E** Ship & runtime | Terraform → Checkov | `infra/terraform/`, CI |

## Required CI checks (Protect Main ruleset)

These must stay required on `main`:

1. **`Governance Steps 1–5`** — `.github/workflows/ai-guardrail.yml`
2. **`Enterprise Layers B–E`** — `.github/workflows/enterprise-hygiene.yml`
3. **`CodeQL (Layer C)`** — python job in `.github/workflows/codeql.yml`

Also recommended on Protect Main: Code Owner review, dismiss stale reviews, up-to-date branch, approval of most recent push, signed commits, CodeQL code-scanning gate.

## Notes

- Alte' Budgeting product code lives in [`web/`](web/).
- FastAPI product stub was removed; governance + dashboard remain.
- See [`SETUP_GOVERNANCE.md`](SETUP_GOVERNANCE.md) and [`SECURITY_OPERATOR_CHECKLIST.md`](SECURITY_OPERATOR_CHECKLIST.md).
