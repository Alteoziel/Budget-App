import { NextRequest, NextResponse } from "next/server";
import {
  authorizeIngest,
  authorizeReviewer,
  isProductionLike,
  unauthorizedResponse,
} from "@/lib/auth";
import { buildPullMergeUrl } from "@/lib/github";
import {
  getReview,
  updateReview,
  updateReviewConditional,
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
    const updated = await updateReview(id, {
      status: "rejected",
      reviewer_note: note,
    });
    return NextResponse.json({
      review: updated ? sanitizeReviewForClient(updated) : null,
    });
  }

  if (action === "approve") {
    const updated = await updateReviewConditional(
      id,
      (current) => current.status !== "merged",
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

    const mergeResp = await fetch(mergeTarget.url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        commit_title: `Merge PR #${mergeTarget.pr} via Governance Panel`,
        merge_method: "squash",
      }),
    });

    const mergeJson = (await mergeResp.json().catch(() => ({}))) as {
      sha?: string;
      message?: string;
    };
    if (!mergeResp.ok) {
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

    const updated = await updateReviewConditional(
      id,
      (current) => current.passed === true && current.status !== "merged",
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
