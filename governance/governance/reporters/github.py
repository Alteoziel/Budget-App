"""GitHub / dashboard reporters for pipeline results."""

from __future__ import annotations

import os
from typing import Any

import httpx

from governance.models import Finding, PipelineReport


def format_markdown(report: PipelineReport) -> str:
    lines = [
        "## AI Code Guardrail Report",
        "",
        f"**Overall:** {'✅ PASSED' if report.passed else '❌ FAILED'}",
        f"**Blocking findings:** {report.summary.get('blocking_findings', 0)}",
        "",
    ]
    for step in report.steps:
        icon = "⏭" if step.skipped else ("✅" if step.passed else "❌")
        lines.append(f"### {icon} {step.name}")
        if step.skipped:
            lines.append(f"_Skipped:_ {step.skip_reason}")
            lines.append("")
            continue
        if not step.findings:
            lines.append("_No findings._")
            lines.append("")
            continue
        for f in step.findings:
            loc = ""
            if f.file:
                loc = f"`{f.file}`"
                if f.line:
                    loc += f":{f.line}"
                loc += " — "
            lines.append(f"- **{f.severity.value.upper()}** {loc}{f.message}")
            if f.suggestion:
                lines.append(f"  - Suggestion: {f.suggestion}")
        lines.append("")
    return "\n".join(lines)


def post_github_pr_comment(report: PipelineReport) -> dict[str, Any] | None:
    """Leave a PR comment summarizing the suite (uses GITHUB_TOKEN)."""
    token = os.getenv("GITHUB_TOKEN")
    repo = report.repo or os.getenv("GITHUB_REPOSITORY")
    pr_number = report.pr_number or _env_int("PR_NUMBER")
    if not token or not repo or not pr_number:
        return None

    body = format_markdown(report)
    url = f"https://api.github.com/repos/{repo}/issues/{pr_number}/comments"
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
            },
            json={"body": body},
        )
        resp.raise_for_status()
        return resp.json()


def post_inline_comments(report: PipelineReport, commit_sha: str | None = None) -> int:
    """Post inline review comments for findings that have file+line."""
    token = os.getenv("GITHUB_TOKEN")
    repo = report.repo or os.getenv("GITHUB_REPOSITORY")
    pr_number = report.pr_number or _env_int("PR_NUMBER")
    sha = commit_sha or report.commit_sha or os.getenv("GITHUB_SHA")
    if not token or not repo or not pr_number or not sha:
        return 0

    posted = 0
    with httpx.Client(timeout=30.0) as client:
        for step in report.steps:
            for finding in step.findings:
                if not finding.file or not finding.line:
                    continue
                if finding.severity.value not in {"error", "critical"}:
                    continue
                path = finding.file
                if path.startswith("/"):
                    marker = f"/{repo.split('/')[-1]}/"
                    if marker in path:
                        path = path.split(marker, 1)[1]
                    elif "/workspace/" in path:
                        path = path.split("/workspace/", 1)[1]
                payload = {
                    "body": _inline_body(finding),
                    "commit_id": sha,
                    "path": path,
                    "line": finding.line,
                    "side": "RIGHT",
                }
                url = f"https://api.github.com/repos/{repo}/pulls/{pr_number}/comments"
                resp = client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Accept": "application/vnd.github+json",
                    },
                    json=payload,
                )
                if resp.status_code < 300:
                    posted += 1
    return posted


def post_to_dashboard(report: PipelineReport) -> dict[str, Any] | None:
    """POST pipeline results to the human review dashboard API.

    Soft-fails: dashboard outages must not fail an otherwise-green CI job.
    """
    endpoint = os.getenv("GOVERNANCE_DASHBOARD_URL")
    if not endpoint:
        return None
    from governance.egress import EgressDeniedError, assert_allowed_dashboard_url

    try:
        endpoint = assert_allowed_dashboard_url(endpoint)
    except EgressDeniedError as exc:
        return {"ok": False, "error": str(exc)}
    secret = os.getenv("GOVERNANCE_DASHBOARD_SECRET", "")
    url = f"{endpoint}/api/reviews"
    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "X-Governance-Secret": secret,
                },
                json=report.model_dump(),
            )
            if resp.status_code == 401:
                return {
                    "ok": False,
                    "error": (
                        "401 Unauthorized — GOVERNANCE_DASHBOARD_SECRET in GitHub "
                        "Actions must exactly match GOVERNANCE_DASHBOARD_SECRET on "
                        f"the dashboard host ({endpoint})."
                    ),
                }
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:  # noqa: BLE001 — never fail the suite on dashboard I/O
        return {"ok": False, "error": str(exc)}


def _inline_body(finding: Finding) -> str:
    parts = [
        f"**[{finding.rule_id or finding.step}] {finding.severity.value.upper()}**",
        finding.message,
    ]
    if finding.suggestion:
        parts.append(f"\n💡 {finding.suggestion}")
    return "\n".join(parts)


def _env_int(name: str) -> int | None:
    raw = os.getenv(name)
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None
