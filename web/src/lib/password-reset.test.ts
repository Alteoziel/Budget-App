import assert from "node:assert/strict";

async function main() {
  const previous = process.env.APP_SECURITY_SECRET;
  process.env.APP_SECURITY_SECRET = ["unit", "test", "security", "fixture"].join(
    "-",
  );

  const {
    createLoginApprovalState,
    createRecoveryState,
    verifyLoginApprovalState,
    verifyRecoveryState,
  } = await import("@/lib/password-reset");

  const token = createRecoveryState("user-a");
  assert.equal(verifyRecoveryState(token, "user-a"), true);
  assert.equal(verifyRecoveryState(token, "user-b"), false);
  assert.equal(verifyRecoveryState(`${token}x`, "user-a"), false);
  assert.equal(verifyRecoveryState("not-a-token", "user-a"), false);

  const loginApproval = createLoginApprovalState("user-a");
  assert.equal(verifyLoginApprovalState(loginApproval, "user-a"), true);
  assert.equal(verifyLoginApprovalState(loginApproval, "user-b"), false);
  // Recovery tokens must not satisfy login-approval purpose checks.
  assert.equal(verifyLoginApprovalState(token, "user-a"), false);
  assert.equal(verifyRecoveryState(loginApproval, "user-a"), false);

  if (previous === undefined) delete process.env.APP_SECURITY_SECRET;
  else process.env.APP_SECURITY_SECRET = previous;

  console.log("password-reset.test.ts: ok");
}

void main();
