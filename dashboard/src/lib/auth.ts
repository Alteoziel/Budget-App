import { NextRequest, NextResponse } from "next/server";

export type DashboardAuthStatus = {
  production: boolean;
  dashboardSecretConfigured: boolean;
  reviewerSecretConfigured: boolean;
  reviewerUsesDashboardSecret: boolean;
  insecureDevAllowed: boolean;
  mergeTokenConfigured: boolean;
  ingestHeader: "X-Governance-Secret";
  reviewerHeader: "X-Governance-Reviewer-Secret";
};

/**
 * Ingest/review auth for the governance dashboard.
 *
 * - Production / default: GOVERNANCE_DASHBOARD_SECRET is required.
 * - Local-only escape hatch: set GOVERNANCE_ALLOW_INSECURE_DEV=true
 *   (ignored when NODE_ENV=production).
 */
export function isInsecureDevAllowed(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.VERCEL === "1") return false;
  return process.env.GOVERNANCE_ALLOW_INSECURE_DEV === "true";
}

export function isProductionLike(): boolean {
  return (
    process.env.NODE_ENV === "production" || process.env.VERCEL === "1"
  );
}

export function dashboardSecretConfigured(): boolean {
  return Boolean(process.env.GOVERNANCE_DASHBOARD_SECRET?.trim());
}

export function dashboardAuthStatus(): DashboardAuthStatus {
  const reviewerSecretConfigured = Boolean(
    process.env.GOVERNANCE_REVIEWER_SECRET?.trim()
  );
  return {
    production: process.env.NODE_ENV === "production",
    dashboardSecretConfigured: dashboardSecretConfigured(),
    reviewerSecretConfigured,
    reviewerUsesDashboardSecret: !reviewerSecretConfigured,
    insecureDevAllowed: isInsecureDevAllowed(),
    mergeTokenConfigured: Boolean(
      process.env.GITHUB_TOKEN?.trim() || process.env.GH_MERGE_TOKEN?.trim()
    ),
    ingestHeader: "X-Governance-Secret",
    reviewerHeader: "X-Governance-Reviewer-Secret",
  };
}

/** Constant-time-ish compare of shared secrets (Edge-safe, no Buffer). */
export function secretsMatch(
  provided: string | null | undefined,
  expected: string | null | undefined
): boolean {
  if (!provided || !expected) return false;
  const a = provided;
  const b = expected;
  const max = Math.max(a.length, b.length);
  let out = a.length === b.length ? 0 : 1;
  for (let i = 0; i < max; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    out |= ca ^ cb;
  }
  return out === 0;
}

export function authorizeIngest(req: NextRequest): boolean {
  const expected = process.env.GOVERNANCE_DASHBOARD_SECRET?.trim();
  if (!expected) {
    return isInsecureDevAllowed();
  }
  return secretsMatch(req.headers.get("x-governance-secret"), expected);
}

/** Human actions: approve / reject / merge */
export function authorizeReviewer(req: NextRequest): boolean {
  const reviewer =
    process.env.GOVERNANCE_REVIEWER_SECRET?.trim() ||
    process.env.GOVERNANCE_DASHBOARD_SECRET?.trim();
  if (!reviewer) {
    return isInsecureDevAllowed();
  }
  const provided =
    req.headers.get("x-governance-reviewer-secret") ||
    req.headers.get("x-governance-secret");
  return secretsMatch(provided, reviewer);
}

export function unauthorizedResponse(kind: "ingest" | "reviewer" = "ingest") {
  const hint =
    kind === "ingest"
      ? "Set GOVERNANCE_DASHBOARD_SECRET and send header X-Governance-Secret."
      : "Set GOVERNANCE_DASHBOARD_SECRET (or GOVERNANCE_REVIEWER_SECRET) and send header X-Governance-Reviewer-Secret.";
  return NextResponse.json(
    {
      error: "unauthorized",
      message: hint,
    },
    { status: 401 }
  );
}
