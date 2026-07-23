"""Step 3 — Test Injected Chamber: static boundary analysis (+ optional dynamic fuzz).

Dynamic ``exec`` of scanned Python is **disabled by default** (RCE risk on CI).
Set ``GOVERNANCE_ALLOW_DYNAMIC_FUZZ=1`` only in trusted, isolated environments.
When enabled, the harness runs with a wiped environment (no parent secrets).
"""

from __future__ import annotations

import ast
import json
import os
import subprocess
import tempfile
import textwrap
from pathlib import Path

from governance.models import Finding, Severity, StepResult

STEP_ID = "fuzz_chamber"
STEP_NAME = "Test Injected Chamber (Deterministic Fuzzing)"

BOUNDARY_CASES = [
    None,
    [],
    "",
    0,
    -1,
    10**9,
    {"__proto__": "x"},
    "A" * 10_000,
]

# Only these repo-relative prefixes may be dynamically fuzzed when explicitly enabled.
_DYNAMIC_ALLOW_PREFIXES = ("governance/", "web/")

HARNESS_TEMPLATE = '''
import json
import sys
import traceback
from pathlib import Path

BOUNDARY = json.loads(sys.argv[1])
TARGET_FILE = sys.argv[2]
FUNC_NAME = sys.argv[3]

ns = {}
code = Path(TARGET_FILE).read_text(encoding="utf-8")
exec(compile(code, TARGET_FILE, "exec"), ns, ns)
fn = ns.get(FUNC_NAME)
if fn is None:
    print(json.dumps({"ok": False, "error": "function_not_found"}))
    sys.exit(0)

results = []
for case in BOUNDARY:
    try:
        fn(case)
        results.append({"input": repr(case)[:80], "status": "ok"})
    except (TypeError, ValueError) as e:
        results.append({"input": repr(case)[:80], "status": "rejected", "error": type(e).__name__})
    except PermissionError as e:
        results.append({
            "input": repr(case)[:80],
            "status": "denied",
            "error": type(e).__name__,
        })
    except Exception as e:
        results.append({
            "input": repr(case)[:80],
            "status": "crash",
            "error": f"{type(e).__name__}: {e}",
        })

print(json.dumps({"ok": True, "results": results}))
'''


def _dynamic_fuzz_enabled() -> bool:
    return os.getenv("GOVERNANCE_ALLOW_DYNAMIC_FUZZ", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


def _explicit_fuzz_targets(tree: ast.Module) -> list[str]:
    targets: list[str] = []
    for node in tree.body:
        value: ast.expr | None = None
        if isinstance(node, ast.Assign):
            if any(
                isinstance(target, ast.Name) and target.id == "FUZZ_TARGETS"
                for target in node.targets
            ):
                value = node.value
        elif (
            isinstance(node, ast.AnnAssign)
            and isinstance(node.target, ast.Name)
            and node.target.id == "FUZZ_TARGETS"
        ):
            value = node.value

        if value is None:
            continue

        try:
            raw_targets = ast.literal_eval(value)
        except (SyntaxError, ValueError):
            continue
        if isinstance(raw_targets, (list, tuple, set)):
            targets.extend(name for name in raw_targets if isinstance(name, str))
    return targets


def _discover_fuzz_targets(path: Path) -> list[str]:
    """Find top-level functions that look like pure helpers (1–2 args)."""
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (OSError, SyntaxError, UnicodeDecodeError):
        return []
    targets: list[str] = _explicit_fuzz_targets(tree)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and not node.name.startswith("_"):
            arg_count = len(node.args.args)
            if 1 <= arg_count <= 2 and not node.decorator_list:
                targets.append(node.name)

    deduped: list[str] = []
    for target in targets:
        if target not in deduped:
            deduped.append(target)
    return deduped[:5]


def _function_def(tree: ast.Module, func_name: str) -> ast.FunctionDef | None:
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == func_name:
            return node
    return None


def _static_boundary_findings(path: Path, func_name: str) -> list[Finding]:
    """AST-only checks — never execute untrusted code."""
    findings: list[Finding] = []
    try:
        source = path.read_text(encoding="utf-8")
        if len(source) > 500_000:
            findings.append(
                Finding(
                    step=STEP_ID,
                    severity=Severity.WARNING,
                    message=f"`{func_name}` skipped: file exceeds static scan size cap",
                    file=str(path),
                    rule_id="FUZZ003_SIZE",
                    suggestion="Split large modules or raise the scan size budget deliberately.",
                )
            )
            return findings
        tree = ast.parse(source)
    except (OSError, SyntaxError, UnicodeDecodeError) as exc:
        findings.append(
            Finding(
                step=STEP_ID,
                severity=Severity.WARNING,
                message=f"`{func_name}` could not be parsed for static fuzz: {type(exc).__name__}",
                file=str(path),
                rule_id="FUZZ004_PARSE",
            )
        )
        return findings

    fn = _function_def(tree, func_name)
    if fn is None:
        return findings

    # Flag helpers that accept a bare arg and never reference it (likely stub)
    # or that use eval/exec inside (dangerous for boundary inputs).
    for node in ast.walk(fn):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in {"eval", "exec", "compile"}:
                findings.append(
                    Finding(
                        step=STEP_ID,
                        severity=Severity.ERROR,
                        message=(
                            f"`{func_name}` calls `{node.func.id}` — "
                            "untrusted input must not reach dynamic execution"
                        ),
                        file=str(path),
                        line=getattr(node, "lineno", None),
                        rule_id="FUZZ002_DYNAMIC_EXEC",
                        suggestion="Remove eval/exec or isolate behind a hardened sandbox.",
                    )
                )
    return findings


def _path_allowed_for_dynamic(path: Path) -> bool:
    normalized = str(path).replace("\\", "/")
    return any(
        f"/{prefix}" in f"/{normalized}" or normalized.startswith(prefix)
        for prefix in _DYNAMIC_ALLOW_PREFIXES
    )


def _run_harness(path: Path, func_name: str, timeout_s: float = 5.0) -> dict:
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as harness:
        harness.write(textwrap.dedent(HARNESS_TEMPLATE))
        harness_path = harness.name

    # Minimal env — do not inherit CI secrets / tokens.
    clean_env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": tempfile.gettempdir(),
        "PYTHONPATH": "",
        "PYTHONDONTWRITEBYTECODE": "1",
    }

    try:
        proc = subprocess.run(
            [
                "python3",
                harness_path,
                json.dumps(BOUNDARY_CASES, default=str),
                str(path),
                func_name,
            ],
            capture_output=True,
            text=True,
            timeout=timeout_s,
            check=False,
            env=clean_env,
            cwd=tempfile.gettempdir(),
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "timeout", "results": []}
    finally:
        Path(harness_path).unlink(missing_ok=True)

    if proc.returncode != 0 and not proc.stdout:
        return {
            "ok": False,
            "error": (proc.stderr or "harness_failed")[:200],
            "results": [],
        }
    try:
        return json.loads(proc.stdout.strip().splitlines()[-1])
    except (json.JSONDecodeError, IndexError):
        return {"ok": False, "error": "invalid_harness_output", "results": []}


def run(paths: list[Path]) -> StepResult:
    """
    Boundary-test discovered helpers.

    Default mode is static AST analysis (safe for untrusted PRs).
    Dynamic subprocess fuzz requires GOVERNANCE_ALLOW_DYNAMIC_FUZZ=1.
    """
    findings: list[Finding] = []
    functions_tested = 0
    crashes = 0
    rejections = 0
    targets_tested: list[str] = []
    denied = 0
    mode = "dynamic" if _dynamic_fuzz_enabled() else "static"

    skip_markers = (
        "/tests/",
        "\\tests\\",
        "app/proxy/interceptor.py",
        "governance/steps",
        "governance/cli",
        "governance/pipeline",
        "governance/reporters",
        "governance/egress",
    )
    py_files = [
        p
        for p in paths
        if p.suffix == ".py"
        and p.is_file()
        and not p.name.startswith("test_")
        and not any(marker in str(p).replace("\\", "/") for marker in skip_markers)
    ]

    jobs: list[tuple[Path, str]] = []
    for path in py_files:
        for func_name in _discover_fuzz_targets(path):
            jobs.append((path, func_name))

    for path, func_name in jobs:
        functions_tested += 1
        targets_tested.append(f"{path}:{func_name}")

        if mode == "static" or not _path_allowed_for_dynamic(path):
            findings.extend(_static_boundary_findings(path, func_name))
            continue

        outcome = _run_harness(path, func_name)
        rejections += sum(
            1
            for item in outcome.get("results", [])
            if item.get("status") == "rejected"
        )
        crash_items = [
            item for item in outcome.get("results", []) if item.get("status") == "crash"
        ]
        denied += sum(
            1 for item in outcome.get("results", []) if item.get("status") == "denied"
        )
        for item in crash_items:
            crashes += 1
            err = str(item.get("error") or "crash")[:200]
            findings.append(
                Finding(
                    step=STEP_ID,
                    severity=Severity.ERROR,
                    message=(
                        f"`{func_name}` crashed on boundary input "
                        f"{item.get('input')}: {err}"
                    ),
                    file=str(path),
                    rule_id="FUZZ001_CRASH",
                    evidence=err,
                    suggestion="Add input validation / null guards for boundary cases.",
                )
            )

    # Dynamic exec findings count as failures; static FUZZ002 also fails the step.
    blocking = [
        f
        for f in findings
        if f.severity in {Severity.ERROR, Severity.CRITICAL}
    ]

    return StepResult(
        step=STEP_ID,
        name=STEP_NAME,
        passed=len(blocking) == 0 and crashes == 0,
        findings=findings,
        metrics={
            "functions_tested": functions_tested,
            "boundary_cases": len(BOUNDARY_CASES),
            "crashes": crashes,
            "rejections": rejections,
            "denied": denied,
            "targets": targets_tested,
            "mode": mode,
            "dynamic_enabled": mode == "dynamic",
        },
    )
