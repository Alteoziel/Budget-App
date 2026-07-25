import assert from "node:assert/strict";
import { authorizeCronRequest, isPlaidSyncStale } from "@/lib/plaid/cron-auth";

const prev = process.env.CRON_SECRET;
process.env.CRON_SECRET = "test-cron-secret-value";

{
  const ok = authorizeCronRequest(
    new Request("https://example.com/api/cron/plaid-sync", {
      headers: { authorization: "Bearer test-cron-secret-value" },
    }),
  );
  assert.equal(ok.ok, true);
}

{
  const bad = authorizeCronRequest(
    new Request("https://example.com/api/cron/plaid-sync", {
      headers: { authorization: "Bearer wrong" },
    }),
  );
  assert.equal(bad.ok, false);
}

{
  const missing = authorizeCronRequest(
    new Request("https://example.com/api/cron/plaid-sync"),
  );
  assert.equal(missing.ok, false);
}

delete process.env.CRON_SECRET;
{
  const unset = authorizeCronRequest(
    new Request("https://example.com/api/cron/plaid-sync", {
      headers: { authorization: "Bearer test-cron-secret-value" },
    }),
  );
  assert.equal(unset.ok, false);
  assert.match(unset.reason ?? "", /not configured/);
}

if (prev === undefined) delete process.env.CRON_SECRET;
else process.env.CRON_SECRET = prev;

const hour = 60 * 60 * 1000;
const now = Date.parse("2026-07-25T16:00:00.000Z");
assert.equal(isPlaidSyncStale(null, 16 * hour, now), true);
assert.equal(isPlaidSyncStale("2026-07-25T06:15:00.000Z", 16 * hour, now), false);
assert.equal(isPlaidSyncStale("2026-07-24T16:00:00.000Z", 16 * hour, now), true);
assert.equal(isPlaidSyncStale("not-a-date", 16 * hour, now), true);

console.log("cron-auth.test.ts: ok");
