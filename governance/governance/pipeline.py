"""Pipeline orchestrator — runs Steps 1–5 sequentially (human review = dashboard)."""

from __future__ import annotations

import subprocess
from pathlib import Path

from governance.models import PipelineReport, StepResult
from governance.steps import (
    ast_guardrail,
    benchmark_engine,
    copyright_filter,
    fuzz_chamber,
    security_auditor,
)


def collect_paths(
    *,
    root: Path,
    files: list[str] | None = None,
    changed_only: bool = False,
    base_ref: str = "origin/main",
) -> list[Path]:
    """Resolve which files the suite should inspect."""
    root_resolved = root.resolve()
    if files:
        resolved: list[Path] = []
        for f in files:
            candidate = Path(f)
            path = candidate if candidate.is_absolute() else root / candidate
            path = path.resolve()
            if not path.is_relative_to(root_resolved):
                raise ValueError(f"Path escapes repository root: {f}")
            resolved.append(path)
        return resolved

    if changed_only:
        proc = subprocess.run(
            [
                "git",
                "diff",
                "--name-only",
                "-z",
                "--diff-filter=ACMR",
                f"{base_ref}...HEAD",
            ],
            cwd=root,
            capture_output=True,
            check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                f"git diff failed for {base_ref}: "
                f"{proc.stderr.decode('utf-8', errors='replace')}"
            )
        names = [n for n in proc.stdout.split(b"\0") if n]
    else:
        proc = subprocess.run(
            ["git", "ls-files", "-z"],
            cwd=root,
            capture_output=True,
            check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                "git ls-files failed: "
                f"{proc.stderr.decode('utf-8', errors='replace')}"
            )
        names = [n for n in proc.stdout.split(b"\0") if n]

    resolved: list[Path] = []
    for raw_name in names:
        name = raw_name.decode("utf-8", errors="surrogateescape")
        path = (root / name).resolve()
        if not path.is_relative_to(root_resolved):
            raise ValueError(f"Git path escapes repository root: {name}")
        if path.is_file() and _is_scannable(path):
            resolved.append(path)
    return resolved


_SKIP_PARTS = {
    ".venv",
    "venv",
    "node_modules",
    ".git",
    ".next",
    ".data",
    "__pycache__",
    ".pytest_cache",
    "dist",
    "build",
    ".eggs",
}


def _is_scannable(path: Path) -> bool:
    parts = set(path.parts)
    if parts & _SKIP_PARTS:
        return False
    if path.suffix in {".pyc", ".pyo", ".so", ".egg"}:
        return False
    return True


def get_diff_text(root: Path, base_ref: str = "origin/main") -> str | None:
    try:
        proc = subprocess.run(
            ["git", "diff", f"{base_ref}...HEAD"],
            cwd=root,
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                f"git diff failed for {base_ref}: {proc.stderr.strip()}"
            )
        return proc.stdout or None
    except OSError:
        return None


def run_pipeline(
    *,
    root: Path,
    files: list[str] | None = None,
    changed_only: bool = False,
    base_ref: str = "origin/main",
    skip_fuzz: bool = False,
    skip_llm: bool = False,
    pr_number: int | None = None,
    commit_sha: str | None = None,
    repo: str | None = None,
) -> PipelineReport:
    paths = collect_paths(
        root=root, files=files, changed_only=changed_only, base_ref=base_ref
    )
    diff_text = get_diff_text(root, base_ref)

    steps: list[StepResult] = []
    steps.append(ast_guardrail.run(paths))
    steps.append(
        security_auditor.run(paths, diff_text=None if skip_llm else diff_text)
    )
    if skip_fuzz:
        steps.append(
            StepResult(
                step="fuzz_chamber",
                name="Test Injected Chamber (Deterministic Fuzzing)",
                passed=True,
                skipped=True,
                skip_reason="--skip-fuzz",
            )
        )
    else:
        steps.append(fuzz_chamber.run(paths))
    steps.append(benchmark_engine.run(paths))
    steps.append(copyright_filter.run(paths))

    passed = all(s.passed or s.skipped for s in steps)
    report = PipelineReport(
        passed=passed,
        steps=steps,
        summary={
            "files": len(paths),
            "blocking_findings": sum(
                1
                for s in steps
                for f in s.findings
                if f.severity.value in {"error", "critical"}
            ),
            "steps_passed": sum(1 for s in steps if s.passed or s.skipped),
            "steps_total": len(steps),
        },
        pr_number=pr_number,
        commit_sha=commit_sha,
        repo=repo,
    )
    return report
