# AI Governance Engine (Steps 1–5)

Python CLI that gates pull requests before they hit `main`.

| Step | Module | What it checks |
|------|--------|----------------|
| 1 | `governance.steps.ast_guardrail` | Nested loops, `eval`/`exec`, complexity |
| 2 | `governance.steps.security_auditor` | OWASP regex rules + optional LLM review |
| 3 | `governance.steps.fuzz_chamber` | Boundary fuzz (null, `[]`, huge inputs) |
| 4 | `governance.steps.benchmark_engine` | Empirical Big-O timing curves |
| 5 | `governance.steps.copyright_filter` | Rabin-Karp + Levenshtein vs signature DB |

Human review (approve / reject / merge) lives in `/dashboard`. There is **no**
comprehension quiz in this repository.

## Install

```bash
cd governance
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## Run locally

```bash
ai-guardrail run --root .
ai-guardrail run --root . -f app/main.py
ai-guardrail run --root . --changed-only --base-ref origin/main
```

## Benchmark target injection

Step 4 remains informational by default, but custom per-PR checks can inject
specific functions into the profiler:

```python
from governance.steps.benchmark_engine import BenchmarkTarget, run


def changed_helper(data: list[int]) -> int:
    return sum(data)


result = run(
    targets=[
        BenchmarkTarget(
            name="changed_helper",
            fn=changed_helper,
            sizes=(10, 100, 1_000),
            expected="O(N)",
        )
    ]
)

print(result.metrics["injected_profiles"]["changed_helper"])
```

## Tests

```bash
pytest
```

## Optional env (CI / LLM)

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` / `GOVERNANCE_LLM_API_KEY` | Step 2 LLM OWASP review |
| `GOVERNANCE_LLM_MODEL` | Model id (default `gpt-4o-mini`) |
| `GOVERNANCE_DASHBOARD_URL` | Human-review ingest base URL |
| `GOVERNANCE_DASHBOARD_SECRET` | Shared secret for dashboard ingest |
