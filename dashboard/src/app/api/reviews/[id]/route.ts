import { NextRequest, NextResponse } from "next/server";
import {
  authorizeIngest,
  authorizeReviewer,
  isProductionLike,
  unauthorizedResponse,
} from "@/lib/auth";
import { buildPullMergeUrl, parseCommitSha } from "@/lib/github";
import {
  getReview,
  transitionReview,
  sanitizeReviewForClient,
} from "@/lib/store";
import {
  authorizeReviewRead,
  siteGateMisconfiguredResponse,
} from "@/lib/reviewAuth";
import { siteGateEnabled } from "@/lib/siteAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  if (isProductionLike() && !siteGateEnabled()) {
    if (!authorizeIngest(req) && !authorizeReviewer(req)) {
      return siteGateMisconfiguredResponse();
    }
  }
  if (!(await authorizeReviewRead(req))) {
    return unauthorizedResponse("ingest");
  }

  const { id } = await params;
  const review = await getReview(id);
  if (!review) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({
    review: sanitizeReviewForClient(review),
  });
}

/**
 * Actions:
 * - approve / reject / merge — human review panel
 *
 * All mutations require reviewer auth (X-Governance-Reviewer-Secret).
 */
export async function POST(req: NextRequest, { params }: Params) {
  if (!authorizeReviewer(req)) {
    return unauthorizedResponse("reviewer");
  }

  const { id } = await params;
  const review = await getReview(id);
  if (!review) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action as "approve" | "reject" | "merge";
  const note = (body.note as string) || null;

  if (action === "reject") {
    const updated = await transitionReview(
      id,
      ["pending_review", "approved", "rejected"],
      false,
      {
        status: "rejected",
        reviewer_note: note,
      }
    );
    if (!updated) {
      return NextResponse.json({ error: "invalid_state" }, { status: 409 });
    }
    return NextResponse.json({
      review: updated ? sanitizeReviewForClient(updated) : null,
    });
  }

  if (action === "approve") {
    const updated = await transitionReview(
      id,
      ["pending_review", "approved", "rejected"],
      false,
      {
        status: "approved",
        reviewer_note: note,
      }
    );
    if (!updated) {
      return NextResponse.json(
        {
          error: "invalid_state",
          message: "Approve blocked by concurrent state change.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({
      review: sanitizeReviewForClient(updated),
    });
  }

  if (action === "merge") {
    if (!review.passed) {
      return NextResponse.json(
        {
          error: "suite_failed",
          message:
            "Automated guardrail suite failed. Fix blocking findings (or reject " +
            "the PR) before merging.",
        },
        { status: 403 }
      );
    }

    const token = process.env.GITHUB_TOKEN || process.env.GH_MERGE_TOKEN;
    if (!token) {
      return NextResponse.json(
        {
          error: "missing_github_token",
          message:
            "Set GITHUB_TOKEN (or GH_MERGE_TOKEN) on the dashboard host to enable merges.",
        },
        { status: 400 }
      );
    }
    const mergeTarget = buildPullMergeUrl(review.repo, review.pr_number);
    if ("error" in mergeTarget) {
      return NextResponse.json(
        {
          error: "missing_pr_metadata",
          message: mergeTarget.error,
        },
        { status: 400 }
      );
    }
    const reviewedSha = parseCommitSha(review.commit_sha);
    if (!reviewedSha) {
      return NextResponse.json(
        {
          error: "missing_reviewed_sha",
          message: "A full reviewed commit SHA is required before merge.",
        },
        { status: 400 }
      );
    }

    const githubHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    };
    const pullUrl = mergeTarget.url.replace(/\/merge$/, "");
    const pullResp = await fetch(pullUrl, { headers: githubHeaders });
    const pull = (await pullResp.json().catch(() => ({}))) as {
      head?: { sha?: string };
      base?: { ref?: string; repo?: { full_name?: string } };
      state?: string;
    };
    if (!pullResp.ok) {
      return NextResponse.json(
        { error: "github_pr_lookup_failed", github_status: pullResp.status },
        { status: 502 }
      );
    }
    const expectedBase = process.env.GITHUB_BASE_BRANCH?.trim() || "main";
    if (
      pull.state !== "open" ||
      pull.head?.sha !== reviewedSha ||
      pull.base?.repo?.full_name !== mergeTarget.repo ||
      pull.base?.ref !== expectedBase
    ) {
      return NextResponse.json(
        {
          error: "review_stale_or_wrong_target",
          message:
            "The pull request head or base no longer matches the reviewed revision.",
        },
        { status: 409 }
      );
    }

    const reserved = await transitionReview(
      id,
      ["pending_review", "approved"],
      true,
      { status: "merging", reviewer_note: note }
    );
    if (!reserved) {
      return NextResponse.json(
        {
          error: "invalid_state",
          message: "Merge blocked by a concurrent review or report change.",
        },
        { status: 409 }
      );
    }

    let mergeResp: Response;
    try {
      mergeResp = await fetch(mergeTarget.url, {
        method: "PUT",
        headers: {
          ...githubHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          commit_title: `Merge PR #${mergeTarget.pr} via Governance Panel`,
          merge_method: "squash",
          sha: reviewedSha,
        }),
      });
    } catch {
      await transitionReview(id, ["merging"], false, { status: "approved" });
      return NextResponse.json(
        { error: "github_merge_unavailable" },
        { status: 502 }
      );
    }

    const mergeJson = (await mergeResp.json().catch(() => ({}))) as {
      sha?: string;
      message?: string;
    };
    if (!mergeResp.ok) {
      await transitionReview(id, ["merging"], false, { status: "approved" });
      return NextResponse.json(
        {
          error: "github_merge_failed",
          message:
            typeof mergeJson.message === "string"
              ? mergeJson.message.slice(0, 200)
              : "GitHub merge failed",
          github_status: mergeResp.status,
        },
        { status: 502 }
      );
    }

    const updated = await transitionReview(
      id,
      ["merging"],
      true,
      {
        status: "merged",
        merge_sha: mergeJson.sha ?? null,
        reviewer_note: note,
      }
    );
    if (!updated) {
      return NextResponse.json(
        {
          error: "invalid_state",
          message: "Merge blocked by concurrent state change.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({
      review: sanitizeReviewForClient(updated),
      merge: { sha: mergeJson.sha ?? null, ok: true },
    });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
