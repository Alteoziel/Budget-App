import assert from "node:assert/strict";
import {
  isPasskeyApiUnavailable,
  resolvePasswordLoginGate,
} from "@/lib/passkey-gate";

assert.deepEqual(
  resolvePasswordLoginGate({
    passkeyCount: 2,
    passkeyCheckOk: true,
    next: "/budget",
  }),
  { kind: "email_approval" },
);

assert.deepEqual(
  resolvePasswordLoginGate({
    passkeyCount: 0,
    passkeyCheckOk: true,
    next: "/accounts",
  }),
  { kind: "passkey_setup", next: "/accounts" },
);

assert.deepEqual(
  resolvePasswordLoginGate({
    passkeyCount: null,
    passkeyCheckOk: false,
    next: "/budget",
  }),
  { kind: "continue", next: "/budget" },
);

assert.equal(
  isPasskeyApiUnavailable({ code: "passkey_disabled" }),
  true,
);
assert.equal(
  isPasskeyApiUnavailable({ message: "Passkeys are disabled" }),
  true,
);
assert.equal(isPasskeyApiUnavailable({ message: "network error" }), false);

console.log("passkey-gate.test.ts: ok");
