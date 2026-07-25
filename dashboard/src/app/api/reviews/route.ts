import { NextRequest, NextResponse } from "next/server";
import {
  authorizeIngest,
  isProductionLike,
  unauthorizedResponse,
} from "@/lib/auth";
import { MAX_INGEST_BYTES, parseIngestBody } from "@/lib/ingest";
import {
  getStoreStatus,
  listReviews,
  upsertReview,
  sanitizeReviewForClient,
} from "@/lib/store";
import {
  authorizeReviewRead,
  siteGateMisconfiguredResponse,
} from "@/lib/reviewAuth";
import { siteGateEnabled } from "@/lib/siteAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readLimitedBody(req: NextRequest): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_INGEST_BYTES) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function GET(req: NextRequest) {
  if (isProductionLike() && !siteGateEnabled()) {
    // Machine auth can still list; otherwise fail closed.
    if (!authorizeIngest(req)) {
      return siteGateMisconfiguredResponse();
    }
  }
  if (!(await authorizeReviewRead(req))) {
    return unauthorizedResponse("ingest");
  }

  const reviews = await listReviews();
  return NextResponse.json({
    reviews: reviews.map(sanitizeReviewForClient),
    store: getStoreStatus(),
  });
}

export async function POST(req: NextRequest) {
  if (!authorizeIngest(req)) {
    return unauthorizedResponse("ingest");
  }

  const declaredLength = Number(req.headers.get("content-length") || "0");
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_INGEST_BYTES
  ) {
    return NextResponse.json(
      { error: "payload_too_large" },
      { status: 413 }
    );
  }
  const rawBody = await readLimitedBody(req);
  if (rawBody === null) {
    return NextResponse.json(
      { error: "payload_too_large" },
      { status: 413 }
    );
  }
  let body: unknown = null;
  try {
    body = JSON.parse(rawBody);
  } catch {
    // parseIngestBody returns a consistent invalid-payload response below.
  }
  const parsed = parseIngestBody(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "invalid_payload", message: parsed.error },
      { status: 400 }
    );
  }

  const review = await upsertReview(parsed.data);

  return NextResponse.json(
    {
      review: sanitizeReviewForClient(review),
    },
    { status: 201 }
  );
}
