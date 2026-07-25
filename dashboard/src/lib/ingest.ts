/**
 * Validate CI ingest payloads before they enter the review store.
 */

import { z } from "zod";
import type { StepResult } from "@/lib/store";

const MAX_STEPS = 32;
const MAX_FINDINGS = 200;
const MAX_STRING = 8_000;
const MAX_SUMMARY_KEYS = 64;

const findingSchema = z.object({
  step: z.string().max(128),
  severity: z.enum(["info", "warning", "error", "critical"]),
  message: z.string().max(MAX_STRING),
  file: z.string().max(1024).nullish(),
  line: z.number().int().nullish(),
  rule_id: z.string().max(128).nullish(),
  evidence: z.string().max(MAX_STRING).nullish(),
  suggestion: z.string().max(MAX_STRING).nullish(),
});

const stepResultSchema = z.object({
  step: z.string().max(128),
  name: z.string().max(256),
  passed: z.boolean(),
  findings: z.array(findingSchema).max(MAX_FINDINGS).default([]),
  metrics: z.record(z.unknown()).optional(),
  skipped: z.boolean().optional(),
  skip_reason: z.string().max(MAX_STRING).nullish(),
});

const ingestSchema = z.object({
  passed: z.boolean(),
  pr_number: z.number().int().positive().nullish(),
  commit_sha: z
    .string()
    .regex(/^[0-9a-f]{40}$/i, "commit_sha must be a full 40-character git SHA")
    .nullish(),
  repo: z
    .string()
    .regex(
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
      "repo must look like owner/name"
    )
    .nullish(),
  steps: z.array(stepResultSchema).max(MAX_STEPS).default([]),
  summary: z.record(z.unknown()).default({}),
});

export type IngestPayload = {
  passed: boolean;
  pr_number: number | null;
  commit_sha: string | null;
  repo: string | null;
  steps: StepResult[];
  summary: Record<string, unknown>;
};

export function parseIngestBody(body: unknown):
  | { ok: true; data: IngestPayload }
  | { ok: false; error: string } {
  const parsed = ingestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const d = parsed.data;
  if (Object.keys(d.summary).length > MAX_SUMMARY_KEYS) {
    return { ok: false, error: `summary exceeds ${MAX_SUMMARY_KEYS} keys` };
  }
  return {
    ok: true,
    data: {
      passed: d.passed,
      pr_number: d.pr_number ?? null,
      commit_sha: d.commit_sha ?? null,
      repo: d.repo ?? null,
      steps: d.steps as StepResult[],
      summary: d.summary,
    },
  };
}
