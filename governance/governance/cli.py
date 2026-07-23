"""CLI entrypoint: `ai-guardrail` / `python -m governance.cli`."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from governance.pipeline import run_pipeline
from governance.reporters import (
    format_markdown,
    post_github_pr_comment,
    post_inline_comments,
    post_to_dashboard,
)

app = typer.Typer(
    name="ai-guardrail",
    help=(
        "AI Code Governance Engine: AST → Security → Fuzz → Bench → Copyright "
        "(human review/merge = dashboard)."
    ),
    add_completion=False,
)
console = Console()


@app.command()
def run(
    path: Optional[list[str]] = typer.Option(
        None, "--file", "-f", help="Specific file(s) to analyze"
    ),
    root: Path = typer.Option(
        Path("."), "--root", help="Repository root (default: cwd)"
    ),
    changed_only: bool = typer.Option(
        False, "--changed-only", help="Only scan files changed vs base ref"
    ),
    base_ref: str = typer.Option("origin/main", "--base-ref"),
    skip_fuzz: bool = typer.Option(False, "--skip-fuzz"),
    skip_llm: bool = typer.Option(False, "--skip-llm"),
    json_out: Optional[Path] = typer.Option(
        None, "--json-out", help="Write machine-readable report JSON"
    ),
    markdown_out: Optional[Path] = typer.Option(
        None, "--markdown-out", help="Write markdown report"
    ),
    comment_pr: bool = typer.Option(
        False, "--comment-pr", help="Post summary comment to GitHub PR"
    ),
    inline_comments: bool = typer.Option(
        False, "--inline-comments", help="Post inline PR review comments"
    ),
    post_dashboard: bool = typer.Option(
        False, "--post-dashboard", help="POST results to review dashboard"
    ),
    pr_number: Optional[int] = typer.Option(None, "--pr-number"),
    commit_sha: Optional[str] = typer.Option(None, "--commit-sha"),
    repo: Optional[str] = typer.Option(None, "--repo", help="owner/name"),
    fail_on_error: bool = typer.Option(
        True, "--fail-on-error/--no-fail-on-error", help="Exit 1 when suite fails"
    ),
) -> None:
    """Run Steps 1–5 and optionally report to GitHub / dashboard."""
    report = run_pipeline(
        root=root.resolve(),
        files=path,
        changed_only=changed_only,
        base_ref=base_ref,
        skip_fuzz=skip_fuzz,
        skip_llm=skip_llm,
        pr_number=pr_number,
        commit_sha=commit_sha,
        repo=repo,
    )

    table = Table(title="AI Governance Engine")
    table.add_column("Step")
    table.add_column("Status")
    table.add_column("Findings")
    for step in report.steps:
        if step.skipped:
            status = "skipped"
        else:
            status = "PASS" if step.passed else "FAIL"
        table.add_row(step.name, status, str(len(step.findings)))
    console.print(table)
    console.print(
        f"[bold]{'PASSED' if report.passed else 'FAILED'}[/bold] — "
        f"{report.summary.get('blocking_findings', 0)} blocking finding(s)"
    )
    console.print(
        "[dim]Human review/merge still happens on the governance dashboard.[/dim]"
    )

    if json_out:
        json_out.write_text(report.model_dump_json(indent=2), encoding="utf-8")
        console.print(f"Wrote JSON report → {json_out}")

    md = format_markdown(report)
    if markdown_out:
        markdown_out.write_text(md, encoding="utf-8")
        console.print(f"Wrote markdown report → {markdown_out}")

    if comment_pr:
        result = post_github_pr_comment(report)
        console.print(
            "PR comment posted."
            if result
            else "PR comment skipped (missing token/repo/pr)."
        )

    if inline_comments:
        n = post_inline_comments(report, commit_sha=commit_sha)
        console.print(f"Inline comments posted: {n}")

    if post_dashboard:
        result = post_to_dashboard(report)
        if result is None:
            console.print(
                "Dashboard post skipped (set GOVERNANCE_DASHBOARD_URL)."
            )
        elif result.get("ok") is False:
            console.print(
                f"[yellow]Dashboard post failed (non-blocking): {result.get('error')}[/yellow]"
            )
        else:
            console.print("Dashboard updated.")

    if fail_on_error and not report.passed:
        raise typer.Exit(code=1)


@app.command("print-report")
def print_report(
    json_path: Path = typer.Argument(..., exists=True, readable=True),
) -> None:
    """Pretty-print a previously saved JSON report as markdown."""
    data = json.loads(json_path.read_text(encoding="utf-8"))
    from governance.models import PipelineReport

    console.print(format_markdown(PipelineReport.model_validate(data)))


def main() -> None:
    app()


if __name__ == "__main__":
    main()
    sys.exit(0)
