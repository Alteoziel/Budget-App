/**
 * Lightweight review store.
 *
 * - Preferred: Upstash Redis (Vercel Marketplace → Upstash)
 * - Fallback (local/dev): in-process memory
 *
 * Intentionally avoids filesystem persistence. Writing HTTP request bodies to
 * disk (and later reading them into outbound fetch calls) is exactly the
 * pattern CodeQL flags as js/http-to-file-access and js/file-access-to-http.
 * Redis/memory keep the same API without that taint path.
 */

import { Redis } from "@upstash/redis";

export type Severity = "info" | "warning" | "error" | "critical";

export type Finding = {
  step: string;
  severity: Severity;
  message: string;
  file?: string | null;
  line?: number | null;
  rule_id?: string | null;
  evidence?: string | null;
  suggestion?: string | null;
};

export type StepResult = {
  step: string;
  name: string;
  passed: boolean;
  findings: Finding[];
  metrics?: Record<string, unknown>;
  skipped?: boolean;
  skip_reason?: string | null;
};

export type ReviewStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "merging"
  | "merged";

export type Review = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ReviewStatus;
  passed: boolean;
  pr_number?: number | null;
  commit_sha?: string | null;
  repo?: string | null;
  steps: StepResult[];
  summary: Record<string, unknown>;
  merge_sha?: string | null;
  reviewer_note?: string | null;
};

export type StoreStatus = {
  backend: "redis" | "memory";
  durable: boolean;
  warning: string | null;
};

const REDIS_KEY = "governance:reviews";
/** Cap retained reviews to bound memory / Redis payload size. */
const MAX_STORED_REVIEWS = 200;

/** Process-local fallback when Redis is not configured (dev / single instance). */
let memoryReviews: Review[] = [];

function isVercel(): boolean {
  return Boolean(process.env.VERCEL);
}

function redisClient(): Redis | null {
  const url = (
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    ""
  ).trim();
  const token = (
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    ""
  ).trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export function getStoreStatus(): StoreStatus {
  if (redisClient()) {
    return { backend: "redis", durable: true, warning: null };
  }
  if (isVercel()) {
    return {
      backend: "memory",
      durable: false,
      warning:
        "Running on Vercel without Upstash Redis. Reviews stay in process memory and will not survive across serverless instances. Add Upstash Redis (Storage tab) and set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_*), then redeploy.",
    };
  }
  return {
    backend: "memory",
    durable: false,
    warning:
      "Using in-memory store (local). Data resets when the process restarts. For durable reviews on Vercel, attach Upstash Redis.",
  };
}

async function readReviews(): Promise<Review[]> {
  const redis = redisClient();
  if (redis) {
    const data = await redis.get<Review[] | string>(REDIS_KEY);
    if (Array.isArray(data)) return data;
    if (typeof data === "string") {
      try {
        const parsed = JSON.parse(data) as Review[];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }
  return memoryReviews;
}

async function writeReviews(reviews: Review[]): Promise<void> {
  const redis = redisClient();
  if (redis) {
    await redis.set(REDIS_KEY, reviews);
    return;
  }
  memoryReviews = reviews;
}

/** Client-safe review (no secrets). */
export function sanitizeReviewForClient(review: Review): Review {
  return { ...review };
}

export async function listReviews(): Promise<Review[]> {
  try {
    const reviews = await readReviews();
    return reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (err) {
    console.error("[governance-store] listReviews failed", err);
    return [];
  }
}

export async function getReview(id: string): Promise<Review | null> {
  try {
    const reviews = await readReviews();
    return reviews.find((r) => r.id === id) ?? null;
  } catch (err) {
    console.error("[governance-store] getReview failed", err);
    return null;
  }
}

export async function upsertReview(
  payload: Omit<Review, "id" | "createdAt" | "updatedAt" | "status"> & {
    status?: ReviewStatus;
  }
): Promise<Review> {
  const redis = redisClient();
  if (redis) {
    const now = new Date().toISOString();
    const candidate: Review = {
      id: `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
      status: payload.status ?? "pending_review",
      passed: payload.passed,
      pr_number: payload.pr_number,
      commit_sha: payload.commit_sha,
      repo: payload.repo,
      steps: payload.steps,
      summary: payload.summary,
    };
    const script = `
      local raw = redis.call("GET", KEYS[1])
      local reviews = raw and cjson.decode(raw) or {}
      local incoming = cjson.decode(ARGV[1])
      local found = nil
      for i, current in ipairs(reviews) do
        if current.repo and incoming.repo
          and current.pr_number and incoming.pr_number
          and current.commit_sha and incoming.commit_sha
          and current.repo == incoming.repo
          and current.pr_number == incoming.pr_number
          and current.commit_sha == incoming.commit_sha then
          local protected_status = current.status == "approved"
            or current.status == "rejected"
            or current.status == "merging"
            or current.status == "merged"
          incoming.id = current.id
          incoming.createdAt = current.createdAt
          if protected_status then incoming.status = current.status end
          reviews[i] = incoming
          found = incoming
          break
        end
      end
      if not found then
        table.insert(reviews, 1, incoming)
        found = incoming
      end
      while #reviews > tonumber(ARGV[2]) do table.remove(reviews) end
      redis.call("SET", KEYS[1], cjson.encode(reviews))
      return cjson.encode(found)
    `;
    const result = await redis.eval<string>(
      script,
      [REDIS_KEY],
      [JSON.stringify(candidate), String(MAX_STORED_REVIEWS)]
    );
    return typeof result === "string"
      ? (JSON.parse(result) as Review)
      : (result as Review);
  }

  const reviews = await readReviews();
  const now = new Date().toISOString();
  const initialStatus: ReviewStatus = payload.status ?? "pending_review";

  const existingIdx = reviews.findIndex(
    (r) =>
      r.repo &&
      payload.repo &&
      r.pr_number &&
      payload.pr_number &&
      r.commit_sha &&
      payload.commit_sha &&
      r.repo === payload.repo &&
      r.pr_number === payload.pr_number &&
      r.commit_sha === payload.commit_sha
  );

  if (existingIdx >= 0) {
    const prev = reviews[existingIdx];
    let nextStatus: ReviewStatus;
    if (payload.status) {
      nextStatus = payload.status;
    } else if (prev.status === "merged") {
      nextStatus = "merged";
    } else if (prev.status === "approved" || prev.status === "rejected") {
      nextStatus = prev.status;
    } else {
      nextStatus = "pending_review";
    }

    const updated: Review = {
      ...prev,
      ...payload,
      status: nextStatus,
      updatedAt: now,
    };
    reviews[existingIdx] = updated;
    await writeReviews(reviews.slice(0, MAX_STORED_REVIEWS));
    return updated;
  }

  const review: Review = {
    id: `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    status: initialStatus,
    passed: payload.passed,
    pr_number: payload.pr_number,
    commit_sha: payload.commit_sha,
    repo: payload.repo,
    steps: payload.steps,
    summary: payload.summary,
  };
  reviews.unshift(review);
  await writeReviews(reviews.slice(0, MAX_STORED_REVIEWS));
  return review;
}

/** Atomically apply a state transition in Redis. */
export async function transitionReview(
  id: string,
  allowedStatuses: ReviewStatus[],
  requirePassed: boolean,
  patch: Partial<Review>
): Promise<Review | null> {
  const redis = redisClient();
  if (redis) {
    const script = `
      local raw = redis.call("GET", KEYS[1])
      if not raw then return nil end
      local reviews = cjson.decode(raw)
      local allowed = cjson.decode(ARGV[2])
      local patch = cjson.decode(ARGV[4])
      for i, current in ipairs(reviews) do
        if current.id == ARGV[1] then
          local status_ok = false
          for _, status in ipairs(allowed) do
            if current.status == status then status_ok = true break end
          end
          if not status_ok then return nil end
          if ARGV[3] == "1" and current.passed ~= true then return nil end
          for key, value in pairs(patch) do current[key] = value end
          current.updatedAt = ARGV[5]
          reviews[i] = current
          redis.call("SET", KEYS[1], cjson.encode(reviews))
          return cjson.encode(current)
        end
      end
      return nil
    `;
    const result = await redis.eval<string | null>(
      script,
      [REDIS_KEY],
      [
        id,
        JSON.stringify(allowedStatuses),
        requirePassed ? "1" : "0",
        JSON.stringify(patch),
        new Date().toISOString(),
      ]
    );
    if (!result) return null;
    return typeof result === "string"
      ? (JSON.parse(result) as Review)
      : (result as Review);
  }

  const reviews = await readReviews();
  const idx = reviews.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const current = reviews[idx];
  if (
    !allowedStatuses.includes(current.status) ||
    (requirePassed && !current.passed)
  ) {
    return null;
  }
  reviews[idx] = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeReviews(reviews.slice(0, MAX_STORED_REVIEWS));
  return reviews[idx];
}
