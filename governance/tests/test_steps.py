"""Unit tests for governance engine steps."""

from __future__ import annotations

from pathlib import Path

from governance.steps import (
    ast_guardrail,
    copyright_filter,
    security_auditor,
)
from governance.steps.benchmark_engine import estimate_big_o


def _write_app_file(tmp_path: Path, relative: str, source: str) -> Path:
    path = tmp_path / "app" / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(source, encoding="utf-8")
    return path


def test_ast_flags_nested_loops(tmp_path: Path) -> None:
    src = tmp_path / "bad.py"
    src.write_text(
        "def f(a, b, c):\n"
        "    for x in a:\n"
        "        for y in b:\n"
        "            for z in c:\n"
        "                print(x, y, z)\n",
        encoding="utf-8",
    )
    result = ast_guardrail.run([src])
    assert not result.passed
    assert any(f.rule_id == "AST001_NESTED_LOOPS" for f in result.findings)


def test_ast_flags_eval(tmp_path: Path) -> None:
    src = tmp_path / "evil.py"
    src.write_text("def run(x):\n    return eval(x)\n", encoding="utf-8")
    result = ast_guardrail.run([src])
    assert not result.passed
    assert any(f.rule_id == "AST002_FORBIDDEN_CALL" for f in result.findings)


def test_ast_clean_file(tmp_path: Path) -> None:
    src = tmp_path / "ok.py"
    src.write_text(
        "def lookup(items, key):\n"
        "    index = {x: i for i, x in enumerate(items)}\n"
        "    return index.get(key)\n",
        encoding="utf-8",
    )
    result = ast_guardrail.run([src])
    assert result.passed


def test_ast_flags_requests_sync_usage_in_app(tmp_path: Path) -> None:
    src = _write_app_file(
        tmp_path,
        "bad_requests.py",
        "import requests\n\n"
        "def call(url):\n"
        "    return requests.get(url)\n",
    )
    result = ast_guardrail.run([src])
    assert not result.passed
    assert any(
        f.rule_id == "AST004_SYNC_HTTP_CLIENT_IN_APP" for f in result.findings
    )


def test_ast_flags_httpx_sync_client_in_app(tmp_path: Path) -> None:
    src = _write_app_file(
        tmp_path,
        "bad_httpx.py",
        "from httpx import Client\n\n"
        "def call(url):\n"
        "    with Client() as client:\n"
        "        return client.get(url)\n",
    )
    result = ast_guardrail.run([src])
    assert not result.passed
    assert any(
        f.rule_id == "AST004_SYNC_HTTP_CLIENT_IN_APP" for f in result.findings
    )


def test_ast_allows_httpx_async_client_in_app(tmp_path: Path) -> None:
    src = _write_app_file(
        tmp_path,
        "ok_async_httpx.py",
        "import httpx\n\n"
        "async def call(url):\n"
        "    async with httpx.AsyncClient() as client:\n"
        "        return await client.get(url)\n",
    )
    result = ast_guardrail.run([src])
    assert result.passed
    assert not any(
        f.rule_id == "AST004_SYNC_HTTP_CLIENT_IN_APP" for f in result.findings
    )


def test_ast_sync_http_rule_is_app_scoped(tmp_path: Path) -> None:
    src = tmp_path / "governance_client.py"
    src.write_text(
        "import httpx\n\n"
        "def call(url):\n"
        "    with httpx.Client() as client:\n"
        "        return client.get(url)\n",
        encoding="utf-8",
    )
    result = ast_guardrail.run([src])
    assert result.passed
    assert not any(
        f.rule_id == "AST004_SYNC_HTTP_CLIENT_IN_APP" for f in result.findings
    )


def test_ast_flags_chat_route_provider_before_interceptor(tmp_path: Path) -> None:
    src = _write_app_file(
        tmp_path,
        "api/v1/chat.py",
        "async def intercept_outbound_request(**kwargs):\n"
        "    return kwargs\n\n"
        "def _resolve_provider(request):\n"
        "    return 'openai'\n\n"
        "async def chat_completions(request_body, request):\n"
        "    provider_name = _resolve_provider(request_body)\n"
        "    normalized = await intercept_outbound_request(body={})\n"
        "    return provider_name, normalized\n",
    )
    result = ast_guardrail.run([src])
    assert not result.passed
    assert any(
        f.rule_id == "AST005_CHAT_INTERCEPTOR_ORDER" for f in result.findings
    )


def test_ast_current_chat_route_calls_interceptor_before_provider() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    src = repo_root / "app" / "api" / "v1" / "chat.py"
    result = ast_guardrail.run([src])
    assert result.passed
    assert not any(
        f.rule_id == "AST005_CHAT_INTERCEPTOR_ORDER" for f in result.findings
    )


def test_security_hardcoded_secret(tmp_path: Path) -> None:
    src = tmp_path / "secrets.py"
    key = "sk-live-" + ("a" * 24)
    src.write_text(f'API_KEY = "{key}"\n', encoding="utf-8")
    result = security_auditor.run([src], diff_text=None)
    assert not result.passed
    assert any(f.rule_id == "SEC001_HARDCODED_SECRET" for f in result.findings)


def test_security_ignores_semgrep_rule_yaml(tmp_path: Path) -> None:
    """Rule definitions mention forbidden APIs — must not block the suite."""
    rules = tmp_path / ".semgrep.yml"
    # Split literals so the auditor does not flag this test file itself.
    forbidden_shell = "os." + "system(...)"
    forbidden_pickle = "pick" + "le.loads"
    rules.write_text(
        "rules:\n"
        "  - id: demo\n"
        f"    pattern: {forbidden_shell}\n"
        f"    message: forbid {forbidden_pickle}\n",
        encoding="utf-8",
    )
    result = security_auditor.run([rules], diff_text=None)
    assert result.passed
    assert result.findings == []


def test_security_does_not_treat_typescript_open_as_file_access(
    tmp_path: Path,
) -> None:
    src = tmp_path / "Menu.tsx"
    src.write_text("const open = useState(false);\\nsetOpen(!open);\\n", encoding="utf-8")
    result = security_auditor.run([src], diff_text=None)
    assert not any(f.rule_id == "SEC006_PATH_TRAVERSAL" for f in result.findings)


def test_security_requires_explicit_route_authorization(tmp_path: Path) -> None:
    src = tmp_path / "route.ts"
    src.write_text(
        'export async function POST(req: Request) { return new Response("ok"); }\\n',
        encoding="utf-8",
    )
    result = security_auditor.run([src], diff_text=None)
    assert not result.passed
    assert any(f.rule_id == "SEC007_ROUTE_AUTH_REQUIRED" for f in result.findings)


def test_security_ssrf_requires_call_not_type_hint(tmp_path: Path) -> None:
    src = tmp_path / "types.py"
    src.write_text(
        "import httpx\n"
        "def handle(request: httpx.Request) -> None:\n"
        "    return None\n",
        encoding="utf-8",
    )
    result = security_auditor.run([src], diff_text=None)
    assert result.passed
    assert not any(f.rule_id == "SEC005_SSRF" for f in result.findings)


def test_big_o_estimator_linear() -> None:
    sizes = [10, 100, 1000, 10000]
    times = [s * 1e-6 for s in sizes]
    label, slope = estimate_big_o(sizes, times)
    assert label == "O(N)"
    assert 0.8 < slope < 1.2


def test_copyright_exact_match(tmp_path: Path) -> None:
    src = tmp_path / "plagiarized.py"
    src.write_text(
        "def twoSum(nums, target):\n"
        "    for i in range(len(nums)):\n"
        "        for j in range(i + 1, len(nums)):\n"
        "            if nums[i] + nums[j] == target:\n"
        "                return [i, j]\n"
        "    return []\n",
        encoding="utf-8",
    )
    result = copyright_filter.run([src])
    assert not result.passed
    assert any(f.rule_id in {"COPY001_EXACT", "COPY002_SIMILAR"} for f in result.findings)


def test_copyright_exact_match_fastapi_httpx_antipattern(tmp_path: Path) -> None:
    signatures = copyright_filter.load_signatures()
    snippet = next(
        sig["content"]
        for sig in signatures
        if sig["id"] == "fastapi_sync_httpx_in_async_route"
    )
    src = tmp_path / "blocked_gateway_clone.py"
    src.write_text(snippet, encoding="utf-8")

    result = copyright_filter.run([src])

    assert result.metrics["signatures"] >= 7
    assert not result.passed
    assert any(
        f.rule_id in {"COPY001_EXACT", "COPY002_SIMILAR"}
        and "fastapi_sync_httpx_in_async_route" in f.message
        for f in result.findings
    )
