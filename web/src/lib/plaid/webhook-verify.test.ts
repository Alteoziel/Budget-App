import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyPlaidWebhook } from "@/lib/plaid/webhook-verify";

async function main() {
  const rawBody = JSON.stringify({
    webhook_type: "TRANSACTIONS",
    webhook_code: "SYNC_UPDATES_AVAILABLE",
    item_id: "fixture-item",
  });
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const keyId = `fixture-${Date.now()}`;
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const publicJwk = await exportJWK(publicKey);
  const signed = await new SignJWT({ request_body_sha256: bodyHash })
    .setProtectedHeader({ alg: "ES256", kid: keyId, typ: "JWT" })
    .setIssuedAt()
    .sign(privateKey);

  const loadKey = async () => ({
    ...publicJwk,
    kid: keyId,
    alg: "ES256",
    use: "sig",
    expired_at: null,
  });

  assert.equal(await verifyPlaidWebhook(rawBody, signed, loadKey), true);
  assert.equal(await verifyPlaidWebhook(`${rawBody} `, signed, loadKey), false);
  assert.equal(await verifyPlaidWebhook(rawBody, null, loadKey), false);
  assert.equal(await verifyPlaidWebhook(rawBody, `${signed}x`, loadKey), false);

  console.log("webhook-verify.test.ts: ok");
}

void main();
