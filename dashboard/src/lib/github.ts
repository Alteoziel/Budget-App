/**
 * Safe GitHub URL helpers for the governance review dashboard.
 */

const REPO_RE = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;

export type GithubRepoRef = {
  owner: string;
  name: string;
  full: string;
};

export function parseGithubRepo(repo: string | null | undefined): GithubRepoRef | null {
  if (!repo || typeof repo !== "string") return null;
  const match = REPO_RE.exec(repo.trim());
  if (!match) return null;
  return { owner: match[1], name: match[2], full: `${match[1]}/${match[2]}` };
}

export function parsePositiveInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function parseCommitSha(sha: string | null | undefined): string | null {
  if (!sha || typeof sha !== "string") return null;
  const trimmed = sha.trim();
  if (!/^[0-9a-f]{40}$/i.test(trimmed)) return null;
  return trimmed;
}

/**
 * Build a GitHub merge URL from validated components.
 * GITHUB_REPOSITORY is required in production/Vercel; otherwise use the parsed repo.
 */
export function buildPullMergeUrl(
  repo: string | null | undefined,
  prNumber: unknown
): { url: string; repo: string; pr: number } | { error: string } {
  const parsed = parseGithubRepo(repo);
  if (!parsed) {
    return { error: "Review repo must look like owner/name." };
  }

  const allowed = process.env.GITHUB_REPOSITORY?.trim();
  const prodLike =
    process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  if (prodLike && !allowed) {
    return {
      error:
        "GITHUB_REPOSITORY must be set in production to pin merge targets.",
    };
  }
  if (allowed) {
    const allowedParsed = parseGithubRepo(allowed);
    if (!allowedParsed || allowedParsed.full !== parsed.full) {
      return {
        error: `Review repo ${parsed.full} is not allowed (expected ${allowed}).`,
      };
    }
  }

  const pr = parsePositiveInt(prNumber);
  if (pr === null) {
    return { error: "Review has no valid PR number." };
  }

  return {
    url: `https://api.github.com/repos/${parsed.owner}/${parsed.name}/pulls/${pr}/merge`,
    repo: parsed.full,
    pr,
  };
}

export function dashboardReviewUrl(reviewId: string): string | null {
  const base =
    process.env.GOVERNANCE_DASHBOARD_PUBLIC_URL?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    null;
  if (!base) return null;
  const host = base.startsWith("http") ? base : `https://${base}`;
  return `${host.replace(/\/$/, "")}/?id=${encodeURIComponent(reviewId)}`;
}
