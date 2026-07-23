"""Tests for GitHub / dashboard reporters."""

from __future__ import annotations

from governance.models import Finding, PipelineReport, Severity, StepResult
from governance.reporters.github import format_markdown


def test_format_markdown_includes_findings() -> None:
    report = PipelineReport(
        passed=False,
        steps=[
            StepResult(
                step="ast_guardrail",
                name="AST Guardrail",
                passed=False,
                findings=[
                    Finding(
                        step="ast_guardrail",
                        severity=Severity.ERROR,
                        message="nested loops",
                        file="app/main.py",
                        line=10,
                        rule_id="AST001",
                        suggestion="flatten",
                    )
                ],
            )
        ],
        summary={"blocking_findings": 1},
    )
    md = format_markdown(report)
    assert "FAILED" in md
    assert "AST Guardrail" in md
    assert "nested loops" in md
    assert "flatten" in md
