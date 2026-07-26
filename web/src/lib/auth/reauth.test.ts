import assert from "node:assert/strict";
import {
  hasRecentPrimarySignIn,
  REAUTH_INTERVAL_MS,
} from "@/lib/auth/reauth";

const now = Date.parse("2026-07-25T19:00:00.000Z");

assert.equal(hasRecentPrimarySignIn(null, now), false);
assert.equal(hasRecentPrimarySignIn("", now), false);
assert.equal(hasRecentPrimarySignIn("not-a-date", now), false);
assert.equal(
  hasRecentPrimarySignIn(new Date(now + 1).toISOString(), now),
  false,
);
assert.equal(hasRecentPrimarySignIn(new Date(now).toISOString(), now), true);
assert.equal(
  hasRecentPrimarySignIn(
    new Date(now - REAUTH_INTERVAL_MS + 1).toISOString(),
    now,
  ),
  true,
);
assert.equal(
  hasRecentPrimarySignIn(
    new Date(now - REAUTH_INTERVAL_MS).toISOString(),
    now,
  ),
  false,
);

console.log("reauth.test.ts: ok");
