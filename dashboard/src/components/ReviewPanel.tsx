"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Review, StepResult } from "@/lib/store";

/**
 * Keep the reviewer secret in process memory only — never sessionStorage /
 * localStorage (CodeQL js/clear-text-storage-of-sensitive-data).
 * Cleared on full page reload; user re-enters via Unlock.
 */
let reviewerSecretMemory = "";

function getReviewerSecret(): string {
  if (typeof window === "undefined") return "";
  return reviewerSecretMemory;
}

function setReviewerSecret(value: string) {
  reviewerSecretMemory = value;
}

function clearReviewerSecret() {
  reviewerSecretMemory = "";
}

function ensureReviewerSecret(): string | null {
  let secret = getReviewerSecret();
  if (!secret) {
    secret =
      window.prompt(
        "Enter reviewer secret (GOVERNANCE_REVIEWER_SECRET):"
      ) || "";
    if (!secret) return null;
    setReviewerSecret(secret);
  }
  return secret;
}

function authHeaders(): HeadersInit {
  const secret = getReviewerSecret();
  return {
    "Content-Type": "application/json",
    ...(secret ? { "X-Governance-Reviewer-Secret": secret } : {}),
  };
}

function statusColor(status: Review["status"]) {
  switch (status) {
    case "merged":
    case "approved":
      return "text-signal";
    case "rejected":
      return "text-alert";
    default:
      return "text-warn";
  }
}

type BenchmarkProfile = {
  sizes: number[];
  times_ms: number[];
  estimated: string;
};

function safeBenchmarkProfiles(
  metrics: Record<string, unknown> | undefined
): Record<string, BenchmarkProfile> | null {
  const raw = metrics?.profiles;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const output: Record<string, BenchmarkProfile> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      continue;
    }
    const profile = value as Record<string, unknown>;
    const sizes = profile.sizes;
    const times = profile.times_ms;
    if (
      !Array.isArray(sizes) ||
      !Array.isArray(times) ||
      sizes.length > 64 ||
      sizes.length !== times.length ||
      !sizes.every((item) => typeof item === "number" && Number.isFinite(item)) ||
      !times.every((item) => typeof item === "number" && Number.isFinite(item))
    ) {
      continue;
    }
    output[name.slice(0, 128)] = {
      sizes,
      times_ms: times,
      estimated:
        typeof profile.estimated === "string"
          ? profile.estimated.slice(0, 128)
          : "unknown",
    };
  }
  return Object.keys(output).length ? output : null;
}

function StepCard({ step }: { step: StepResult }) {
  const profiles = safeBenchmarkProfiles(step.metrics);

  const chartData =
    profiles &&
    Object.entries(profiles).flatMap(([name, p]) =>
      p.sizes.map((size, i) => ({
        name: `${name}@${size}`,
        algo: name,
        size,
        ms: p.times_ms[i],
      }))
    );

  return (
    <section className="border-b border-white/10 py-6 last:border-0">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-xl text-white">{step.name}</h3>
        <span
          className={`text-sm font-semibold uppercase tracking-wide ${
            step.skipped ? "text-mist" : step.passed ? "text-signal" : "text-alert"
          }`}
        >
          {step.skipped ? "skipped" : step.passed ? "pass" : "fail"}
        </span>
      </div>

      {step.findings.length === 0 ? (
        <p className="text-sm text-mist">No findings.</p>
      ) : (
        <ul className="space-y-2">
          {step.findings.map((f, i) => (
            <li
              key={`${f.rule_id}-${i}`}
              className="rounded-md bg-black/25 px-3 py-2 text-sm"
            >
              <span className="font-semibold uppercase text-mist">
                {f.severity}
              </span>
              {f.file ? (
                <span className="text-mist">
                  {" "}
                  · {f.file}
                  {f.line ? `:${f.line}` : ""}
                </span>
              ) : null}
              <p className="mt-1 text-white/90">{f.message}</p>
              {f.suggestion ? (
                <p className="mt-1 text-mist">{f.suggestion}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {chartData && chartData.length > 0 ? (
        <div className="mt-5 h-56 w-full">
          <p className="mb-2 text-xs uppercase tracking-wider text-mist">
            Big-O timing curves (ms)
          </p>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff22" />
              <XAxis dataKey="name" tick={{ fill: "#9aa8c0", fontSize: 10 }} />
              <YAxis tick={{ fill: "#9aa8c0", fontSize: 10 }} />
              <Tooltip
                contentStyle={{
                  background: "#141c2e",
                  border: "1px solid #ffffff22",
                }}
              />
              <Bar dataKey="ms" fill="#3d9a7a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </section>
  );
}

function ReviewerUnlock() {
  const [hasSecret, setHasSecret] = useState(false);

  useEffect(() => {
    setHasSecret(Boolean(getReviewerSecret()));
  }, []);

  return (
    <div className="mb-4 rounded-md border border-white/10 bg-black/25 px-3 py-3 text-sm text-mist">
      {hasSecret ? (
        <div className="space-y-1">
          <p className="font-semibold text-signal">
            Review actions unlocked for this browser session.
          </p>
          <p>
            Approve, reject, and merge calls send{" "}
            <code>X-Governance-Reviewer-Secret</code>. If a request returns 401,
            clear the saved secret and unlock again.
          </p>
          <button
            type="button"
            className="text-signal underline"
            onClick={() => {
              clearReviewerSecret();
              setHasSecret(false);
            }}
          >
            Clear saved reviewer secret
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-warn">Review actions locked.</p>
            <p>
              Enter <code>GOVERNANCE_REVIEWER_SECRET</code> or the dashboard
              secret to approve, reject, or merge.
            </p>
          </div>
          <button
            type="button"
            className="rounded-md bg-white/10 px-3 py-1 text-white hover:bg-white/20"
            onClick={() => {
              const s = ensureReviewerSecret();
              setHasSecret(Boolean(s));
            }}
          >
            Unlock actions
          </button>
        </div>
      )}
    </div>
  );
}

export function ReviewActions({ review }: { review: Review }) {
  async function act(action: "approve" | "reject" | "merge") {
    if (!ensureReviewerSecret()) {
      alert("Reviewer secret required.");
      return;
    }
    const note =
      action === "reject"
        ? window.prompt("Rejection note (optional):") ?? ""
        : action === "merge"
          ? window.prompt(
              "Merge confirmation note (optional). This calls GitHub merge API:"
            ) ?? ""
          : "";
    const res = await fetch(`/api/reviews/${review.id}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ action, note }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) {
        clearReviewerSecret();
      }
      alert(data.message || data.error || "Action failed");
      return;
    }
    window.location.reload();
  }

  const mergeLocked = !review.passed;

  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <button
        type="button"
        onClick={() => act("approve")}
        className="rounded-md bg-signal px-4 py-2 text-sm font-semibold text-ink transition hover:brightness-110"
      >
        Approve
      </button>
      <button
        type="button"
        onClick={() => act("reject")}
        className="rounded-md border border-alert/60 px-4 py-2 text-sm font-semibold text-alert transition hover:bg-alert/10"
      >
        Reject
      </button>
      <button
        type="button"
        disabled={mergeLocked}
        onClick={() => act("merge")}
        className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Approve &amp; Merge
      </button>
      <p className={`w-full text-sm ${statusColor(review.status)}`}>
        Status: {review.status.replaceAll("_", " ")}
        {!review.passed ? " · suite failed — merge blocked" : ""}
      </p>
    </div>
  );
}

export function ReviewDetail({ review }: { review: Review }) {
  return (
    <article className="rounded-xl bg-slatepanel/80 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <header className="mb-4 border-b border-white/10 pb-4">
        <p className="text-xs uppercase tracking-[0.2em] text-mist">
          Human Review Panel
        </p>
        <h2 className="mt-2 font-display text-3xl text-white">
          {review.repo ? `${review.repo}` : "Local review"}
          {review.pr_number ? ` · PR #${review.pr_number}` : ""}
        </h2>
        <p className="mt-2 text-sm text-mist">
          Suite:{" "}
          {review.passed ? "passed automated gates" : "failed automated gates"} ·{" "}
          {String(review.summary?.blocking_findings ?? 0)} blocking · commit{" "}
          <code className="text-white/80">
            {review.commit_sha?.slice(0, 8) ?? "n/a"}
          </code>
        </p>
        <ReviewerUnlock />
        <ReviewActions review={review} />
      </header>

      {review.steps.map((step) => (
        <StepCard key={step.step} step={step} />
      ))}
    </article>
  );
}
