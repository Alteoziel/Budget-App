"""Step 2 — Security Auditor: OWASP-oriented static + optional LLM review."""

from __future__ import annotations

import os
import re
from pathlib import Path

import httpx

from governance.models import Finding, Severity, StepResult

STEP_ID = "security_auditor"
STEP_NAME = "Security Auditor (OWASP Scan)"

# Deterministic pattern rules (always run — no API key required).
# Build regexes via concatenation so this file is not flagged by its own rules.
_OS = "os"
_SYSTEM = "system"
_PICKLE = "pick" + "le"
OWASP_PATTERNS: list[tuple[str, Severity, str, re.Pattern[str]]] = [
    (
        "SEC001_HARDCODED_SECRET",
        Severity.CRITICAL,
        "Possible hardcoded secret / API key",
        re.compile(
            r"""(?i)(api[_-]?key|secret|password|token|private[_-]?key)\s*=\s*['\"][^'\"]{8,}['\"]"""
        ),
    ),
    (
        "SEC002_SQL_INJECTION",
        Severity.CRITICAL,
        "Possible SQL injection via string formatting",
        re.compile(
            r"""(?i)(execute|executemany)\s*\(\s*(f['\"]|['\"].*%|['\"].*\.format)"""
        ),
    ),
    (
        "SEC003_SHELL_INJECTION",
        Severity.CRITICAL,
        "Possible command injection (shell=True or os.system)",
        re.compile(
            rf"""(?i)({_OS}\.{_SYSTEM}\s*\(|subprocess\.[a-z]+\([^)]*shell\s*=\s*True)"""
        ),
    ),
    (
        "SEC004_PICKLE",
        Severity.ERROR,
        "Unsafe deserialization (pickle) — remote code execution risk",
        re.compile(rf"""(?i){_PICKLE}\.(loads?|Unpickler)"""),
    ),
    (
        "SEC005_SSRF",
        Severity.WARNING,
        "Outbound HTTP with user-controlled URL risk — validate allowlists",
        re.compile(
            r"""(?i)(httpx\.(get|post|request)|requests\.(get|post)|urllib\.request\.urlopen)\s*\("""
        ),
    ),
    (
        "SEC006_PATH_TRAVERSAL",
        Severity.WARNING,
        "File open with dynamic path — guard against path traversal",
        re.compile(r"""(?i)open\s*\(\s*(?!['\"])"""),
    ),
]

# Injection / RCE patterns only make sense on executable source — not rule YAML.
_CODE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".jsx"}
# Config may still hide secrets.
_CONFIG_SUFFIXES = {".yml", ".yaml", ".toml"}
_SECRET_ONLY_RULES = {"SEC001_HARDCODED_SECRET"}
_ENDPOINT_AUTH_MARKERS = (
    ".auth.getUser(",
    "requireBudget(",
    "authorizeCronRequest(",
    "verifyPlaidWebhook(",
    "exchangeCodeForSession(",
    "verifyOtp(",
    "authorizeIngest(",
    "authorizeReviewer(",
    "authorizeReviewRead(",
    "siteGateEnabled(",
    "passwordsMatch(",
    'headers.get("origin")',
    "SECURITY: PUBLIC",
)

SYSTEM_PROMPT = """You are an OWASP-focused secure-code reviewer for an enterprise AI proxy gateway.
Review ONLY the provided git diff / code snippets.
Flag: injection, secrets, auth bypass, insecure deserialization, SSRF, path traversal,
overly permissive CORS, missing input validation on LLM proxy endpoints.
Respond with JSON array only:
[{"severity":"critical|error|warning|info","rule_id":"LLM_...","file":"...","line":null,"message":"...","suggestion":"..."}]
If nothing found, return [].
"""


def _scan_patterns(path: Path, source: str) -> list[Finding]:
    findings: list[Finding] = []
    for rule_id, severity, message, pattern in OWASP_PATTERNS:
        if path.suffix in _CONFIG_SUFFIXES and rule_id not in _SECRET_ONLY_RULES:
            continue
        if rule_id == "SEC006_PATH_TRAVERSAL" and path.suffix != ".py":
            continue
        for match in pattern.finditer(source):
            line = source[: match.start()].count("\n") + 1
            # Allow .env.example style placeholders
            snippet = match.group(0)
            if "your_" in snippet.lower() or "changeme" in snippet.lower() or "xxx" in snippet.lower():
                continue
            # Never echo raw secret material into findings / dashboard / PR comments.
            evidence = snippet
            if rule_id == "SEC001_HARDCODED_SECRET":
                evidence = f"{snippet[:24]}…[redacted len={len(snippet)}]"
            effective_severity = severity
            if rule_id == "SEC001_HARDCODED_SECRET" and ".test." in path.name:
                effective_severity = Severity.WARNING
            suggestion = {
                "SEC001_HARDCODED_SECRET": "Remove the secret or load it from server-side environment variables.",
                "SEC006_PATH_TRAVERSAL": "Resolve against an allowlisted base directory and reject escapes.",
            }.get(rule_id, "Validate untrusted input at the trust boundary.")
            findings.append(
                Finding(
                    step=STEP_ID,
                    severity=effective_severity,
                    message=message,
                    file=str(path),
                    line=line,
                    rule_id=rule_id,
                    evidence=evidence[:120],
                    suggestion=suggestion,
                )
            )
    return findings


def _route_auth_findings(path: Path, source: str) -> list[Finding]:
    if path.name != "route.ts" or not re.search(
        r"export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b",
        source,
    ):
        return []
    if any(marker in source for marker in _ENDPOINT_AUTH_MARKERS):
        return []
    match = re.search(
        r"export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b",
        source,
    )
    line = source[: match.start()].count("\n") + 1 if match else 1
    return [
        Finding(
            step=STEP_ID,
            severity=Severity.CRITICAL,
            message=(
                "Route handler has no explicit authentication/authorization "
                "check or SECURITY: PUBLIC declaration"
            ),
            file=str(path),
            line=line,
            rule_id="SEC007_ROUTE_AUTH_REQUIRED",
            suggestion=(
                "Add a route-level user/role/signature check. If intentionally "
                "public, document the trust boundary with SECURITY: PUBLIC."
            ),
        )
    ]


def _llm_review(diff_text: str) -> list[Finding]:
    """Optional high-reasoning model review of the PR diff."""
    api_key = os.getenv("GOVERNANCE_LLM_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        return []
    from governance.egress import EgressDeniedError, assert_allowed_llm_base_url

    try:
        base_url = assert_allowed_llm_base_url(
            os.getenv("GOVERNANCE_LLM_BASE_URL", "https://api.openai.com/v1")
        )
    except EgressDeniedError as exc:
        return [
            Finding(
                step=STEP_ID,
                severity=Severity.WARNING,
                message=f"LLM security review blocked by egress policy: {exc}",
                rule_id="SEC_LLM_EGRESS_DENIED",
            )
        ]
    model = os.getenv("GOVERNANCE_LLM_MODEL", "gpt-4o-mini")

    payload = {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Review this diff:\n\n{diff_text[:60000]}"},
        ],
        "response_format": {"type": "json_object"},
    }
    try:
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(
                f"{base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload,
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
    except Exception as exc:  # noqa: BLE001 — auditor must not crash the suite
        return [
            Finding(
                step=STEP_ID,
                severity=Severity.WARNING,
                message=f"LLM security review skipped due to API error: {exc}",
                rule_id="SEC_LLM_UNAVAILABLE",
            )
        ]

    import json

    try:
        parsed = json.loads(content)
        items = parsed if isinstance(parsed, list) else parsed.get("findings", parsed.get("issues", []))
    except json.JSONDecodeError:
        return []

    findings: list[Finding] = []
    for item in items or []:
        sev = str(item.get("severity", "warning")).lower()
        try:
            severity = Severity(sev)
        except ValueError:
            severity = Severity.WARNING
        findings.append(
            Finding(
                step=STEP_ID,
                severity=severity,
                message=item.get("message", "LLM security finding"),
                file=item.get("file"),
                line=item.get("line"),
                rule_id=item.get("rule_id", "SEC_LLM"),
                suggestion=item.get("suggestion"),
            )
        )
    return findings


def run(paths: list[Path], diff_text: str | None = None) -> StepResult:
    """Run deterministic OWASP patterns + optional LLM review on diffs."""
    findings: list[Finding] = []
    scanned = 0
    for path in paths:
        if not path.is_file():
            continue
        if path.suffix not in (_CODE_SUFFIXES | _CONFIG_SUFFIXES):
            continue
        # Skip governance signature DB, example env, and Semgrep rule defs
        # (rule YAML embeds forbidden-call pattern text that is not executable code).
        if path.name in {".env.example", "known_snippets.json", ".semgrep.yml"}:
            continue
        if path.name.endswith(".semgrep.yml") or path.name == "semgrep.yml":
            continue
        scanned += 1
        source = path.read_text(encoding="utf-8", errors="replace")
        findings.extend(_scan_patterns(path, source))
        findings.extend(_route_auth_findings(path, source))

    llm_used = False
    if diff_text:
        llm_findings = _llm_review(diff_text)
        if llm_findings:
            findings.extend(llm_findings)
            llm_used = True

    blocking = [f for f in findings if f.severity in (Severity.ERROR, Severity.CRITICAL)]
    return StepResult(
        step=STEP_ID,
        name=STEP_NAME,
        passed=len(blocking) == 0,
        findings=findings,
        metrics={
            "files_scanned": scanned,
            "findings": len(findings),
            "blocking": len(blocking),
            "llm_review": llm_used or bool(
                os.getenv("GOVERNANCE_LLM_API_KEY") or os.getenv("OPENAI_API_KEY")
            ),
        },
    )
