import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import type { NextRequest } from "next/server";

const LOGIN_WINDOW_SECONDS = 60;
const LOGIN_MAX_ATTEMPTS = 5;
let localWindow = 0;
let localAttempts = 0;

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
  return url && token ? new Redis({ url, token }) : null;
}

function trustedClientKey(req: NextRequest): string {
  const prodLike =
    process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  const candidate = prodLike
    ? req.headers.get("x-vercel-forwarded-for")
    : req.headers.get("x-real-ip");
  const ip = candidate?.split(",")[0]?.trim() || "unknown";
  const userAgent = req.headers.get("user-agent")?.slice(0, 256) || "unknown";
  return createHash("sha256")
    .update(`${ip}\0${userAgent}`)
    .digest("hex")
    .slice(0, 32);
}

export async function consumeLoginAttempt(req: NextRequest): Promise<boolean> {
  const window = Math.floor(Date.now() / (LOGIN_WINDOW_SECONDS * 1000));
  const redis = redisClient();
  if (redis) {
    try {
      const key = `governance:login:${window}:${trustedClientKey(req)}`;
      const attempts = await redis.incr(key);
      if (attempts === 1) {
        await redis.expire(key, LOGIN_WINDOW_SECONDS + 5);
      }
      return attempts <= LOGIN_MAX_ATTEMPTS;
    } catch {
      // Fall through to the bounded process-local fail-safe.
    }
  }

  // Small fail-safe fallback for local/single-instance use. It is global rather
  // than attacker-keyed, so untrusted headers cannot grow memory or bypass it.
  if (localWindow !== window) {
    localWindow = window;
    localAttempts = 0;
  }
  localAttempts += 1;
  return localAttempts <= LOGIN_MAX_ATTEMPTS;
}
