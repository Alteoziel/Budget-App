import { createHash, timingSafeEqual } from "node:crypto";
import {
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type CryptoKey,
  type JWK,
} from "jose";
import { getPlaidClient } from "@/lib/plaid/client";

const MAX_KEY_CACHE_ENTRIES = 32;
const keyCache = new Map<string, { key: CryptoKey; expiresAtMs: number }>();

type PlaidKeyLoader = (keyId: string) => Promise<JWK & {
  expired_at?: number | null;
}>;

async function loadPlaidKey(keyId: string): Promise<JWK & {
  expired_at?: number | null;
}> {
  const response = await getPlaidClient().webhookVerificationKeyGet({
    key_id: keyId,
  });
  return response.data.key as JWK & { expired_at?: number | null };
}

async function verificationKey(
  keyId: string,
  loadKey: PlaidKeyLoader,
): Promise<CryptoKey> {
  const now = Date.now();
  const cached = keyCache.get(keyId);
  if (cached && cached.expiresAtMs > now) return cached.key;

  const jwk = await loadKey(keyId);
  if (
    jwk.kid !== keyId ||
    jwk.alg !== "ES256" ||
    jwk.kty !== "EC" ||
    jwk.crv !== "P-256" ||
    (jwk.expired_at != null && jwk.expired_at * 1000 <= now)
  ) {
    throw new Error("Plaid returned an invalid webhook verification key.");
  }

  const key = await importJWK(jwk, "ES256");
  if (key instanceof Uint8Array) {
    throw new Error("Plaid webhook key must be asymmetric.");
  }
  const expiresAtMs =
    jwk.expired_at == null
      ? now + 60 * 60 * 1000
      : Math.min(jwk.expired_at * 1000, now + 60 * 60 * 1000);

  if (keyCache.size >= MAX_KEY_CACHE_ENTRIES) {
    const oldest = keyCache.keys().next().value;
    if (oldest) keyCache.delete(oldest);
  }
  keyCache.set(keyId, { key, expiresAtMs });
  return key;
}

export async function verifyPlaidWebhook(
  rawBody: string,
  signedJwt: string | null,
  loadKey: PlaidKeyLoader = loadPlaidKey,
): Promise<boolean> {
  if (!signedJwt || signedJwt.length > 8192) return false;

  try {
    const header = decodeProtectedHeader(signedJwt);
    if (
      header.alg !== "ES256" ||
      typeof header.kid !== "string" ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(header.kid)
    ) {
      return false;
    }

    const key = await verificationKey(header.kid, loadKey);
    const { payload } = await jwtVerify(signedJwt, key, {
      algorithms: ["ES256"],
      maxTokenAge: "5 minutes",
      clockTolerance: 5,
    });
    const claimedHash = payload.request_body_sha256;
    if (
      typeof claimedHash !== "string" ||
      !/^[a-f0-9]{64}$/i.test(claimedHash)
    ) {
      return false;
    }

    const actual = Buffer.from(
      createHash("sha256").update(rawBody, "utf8").digest("hex"),
      "ascii",
    );
    const claimed = Buffer.from(claimedHash.toLowerCase(), "ascii");
    return actual.length === claimed.length && timingSafeEqual(actual, claimed);
  } catch {
    return false;
  }
}
