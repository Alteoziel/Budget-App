# Enterprise Layers B–E

Automated supply-chain, SAST, product tests, and ship/runtime scaffolding.
These sit **beside** Governance Steps 1–5 (AI Code Guardrail).

| Layer | What | Where |
|-------|------|-------|
| **B** Supply chain & secrets | Dependabot, checksummed Gitleaks, pip-audit, npm audit (high+) | `.github/dependabot.yml`, `.gitleaks.toml`, CI job |
| **C** Static analysis | Ruff, Mypy, Semgrep (custom + packs hard-fail), CodeQL Advanced, CODEOWNERS | `pyproject.toml`, `.semgrep.yml`, `.github/workflows/codeql.yml`, `.github/CODEOWNERS`, CI |
| **D** Product tests | API + security contracts + coverage floor | `tests/`, `pyproject.toml` coverage config |
| **E** Ship & runtime | Egress-checked HTTP client, audit schema, Dockerfile (non-root)→Trivy CRITICAL+HIGH, SBOM, Terraform→Checkov | `app/security/`, `infra/terraform/`, CI |

## Required CI checks (Protect Main ruleset)

These must stay required on `main`:

1. **`Governance Steps 1–5`** — `.github/workflows/ai-guardrail.yml`
2. **`Enterprise Layers B–E`** — `.github/workflows/enterprise-hygiene.yml`
3. **`CodeQL (Layer C)`** — python job in `.github/workflows/codeql.yml`

Also recommended on Protect Main: Code Owner review, dismiss stale reviews, up-to-date branch, approval of most recent push, signed commits, CodeQL code-scanning gate.

## Operator checklist

### Done (repo settings + Protect Main — keep these on)

- [x] Require status checks: Governance Steps 1–5, Enterprise Layers B–E, CodeQL (Layer C)
- [x] Require a pull request before merging
- [x] Require Code Owner review
- [x] Dismiss stale pull request approvals when new commits are pushed
- [x] Require approval of the most recent reviewable push
- [x] Require branches to be up to date before merging (strict status checks)
- [x] Block force-pushes / branch deletion on default branch
- [x] Require signed commits
- [x] Code scanning rule in ruleset (CodeQL high_or_higher / errors)
- [x] **Code scanning — Advanced setup** (`.github/workflows/codeql.yml` uploads SARIF; `queries: security-extended`)
- [x] **Dependabot alerts + security updates enabled** (repo Code security; `.github/dependabot.yml` present)

### Still optional / later

1. **Secret scanning + push protection**  
   Repo → **Settings** → **Code security** → enable **Secret scanning** and **Push protection**.

2. **Restrict who can push / bypass**  
   Ruleset → set bypass actors to **none** (or only a break-glass admin).

3. **Private vulnerability reporting** (optional)  
   Code security → **Private vulnerability reporting**.

4. **Second human reviewer**  
   When you add a collaborator/team, put them in `.github/CODEOWNERS` for `/app/security/`, `/app/api/`, and `/.github/workflows/`.

5. **Governance dashboard deploy**  
   Review/merge panel — see `SETUP_GOVERNANCE.md`.
