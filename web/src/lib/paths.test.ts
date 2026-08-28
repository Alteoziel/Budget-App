import assert from "node:assert/strict";
import { safeInternalPath } from "@/lib/paths";

assert.equal(safeInternalPath("/budget"), "/budget");
assert.equal(safeInternalPath("/accounts/abc"), "/accounts/abc");
assert.equal(safeInternalPath("//evil.com"), "/budget");
assert.equal(safeInternalPath("/\\evil.com"), "/budget");
assert.equal(safeInternalPath("https://evil.com"), "/budget");
assert.equal(safeInternalPath("budget"), "/budget");
assert.equal(safeInternalPath(null, "/accounts"), "/accounts");
assert.equal(safeInternalPath("/%2f%2fevil.com"), "/budget");
assert.equal(safeInternalPath("/budget/../login"), "/budget");
assert.equal(safeInternalPath("/https://evil.com"), "/budget");
assert.equal(safeInternalPath("/boot.html"), "/budget");
assert.equal(safeInternalPath("/boot.html?next=/budget"), "/budget");
assert.equal(safeInternalPath("/offline.html"), "/budget");
assert.equal(safeInternalPath("/api/offline/snapshot"), "/budget");
assert.equal(safeInternalPath("/passkey-setup"), "/passkey-setup");

console.log("paths.test.ts: ok");
