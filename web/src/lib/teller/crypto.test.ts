import assert from "node:assert/strict";

process.env.TELLER_TOKEN_ENCRYPTION_KEY = "test-encryption-key-for-unit-tests";

async function main() {
  const { encryptSecret, decryptSecret } = await import("@/lib/teller/crypto");

  const plain = "token_sandbox_example_abc123";
  const enc = encryptSecret(plain);
  assert.match(enc, /^[0-9a-f]+:[0-9a-f]{32}:[0-9a-f]+$/);
  assert.equal(decryptSecret(enc), plain);

  const [, tagHex] = enc.split(":");
  assert.equal(Buffer.from(tagHex!, "hex").length, 16);

  assert.throws(() => decryptSecret("00:abcd:00"), /Invalid GCM auth tag length/);

  console.log("crypto.test.ts: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
