from __future__ import annotations

from pathlib import Path

from governance.steps import benchmark_engine, fuzz_chamber
from governance.steps.benchmark_engine import BenchmarkTarget

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_fuzz_chamber_targets_real_budget_helper() -> None:
    result = fuzz_chamber.run([REPO_ROOT / "app" / "security" / "egress.py"])

    assert result.passed
    assert result.metrics["functions_tested"] >= 1
    assert result.metrics["crashes"] == 0
    assert result.metrics["mode"] == "static"
    assert any("is_allowed_url" in t for t in result.metrics["targets"])


def test_fuzz_chamber_static_flags_eval(tmp_path: Path) -> None:
    target = tmp_path / "evil.py"
    target.write_text(
        "def handle(x):\n    return eval(x)\n",
        encoding="utf-8",
    )
    result = fuzz_chamber.run([target])
    assert not result.passed
    assert any(f.rule_id == "FUZZ002_DYNAMIC_EXEC" for f in result.findings)


def test_benchmark_engine_profiles_injected_targets() -> None:
    def linear_target(data: list[int]) -> int:
        return sum(data)

    result = benchmark_engine.run(
        targets=[
            BenchmarkTarget(
                name="pr_linear_target",
                fn=linear_target,
                sizes=(10, 100, 1_000),
                expected="O(N)",
            )
        ]
    )

    assert result.passed
    assert "pr_linear_target" in result.metrics["injected_profiles"]
    assert result.metrics["injected_profiles"]["pr_linear_target"]["expected"] == "O(N)"
