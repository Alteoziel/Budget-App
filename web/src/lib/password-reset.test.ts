import assert from "node:assert/strict";

async function main() {
  const previous = process.env.APP_SECURITY_SECRET;
  process.env.APP_SECURITY_SECRET = ["unit", "test", "security", "fixture"].join(
    "-",
  );

  const { createRecoveryState, verifyRecoveryState } = await import(
    "@/lib/password-reset"
  );

  const token = createRecoveryState("user-a");
  assert.equal(verifyRecoveryState(token, "user-a"), true);
  assert.equal(verifyRecoveryState(token, "user-b"), false);
  assert.equal(verifyRecoveryState(`${token}x`, "user-a"), false);
  assert.equal(verifyRecoveryState("not-a-token", "user-a"), false);

  if (previous === undefined) delete process.env.APP_SECURITY_SECRET;
  else process.env.APP_SECURITY_SECRET = previous;

  console.log("password-reset.test.ts: ok");
}

void main();
