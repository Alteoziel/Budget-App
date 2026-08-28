import assert from "node:assert/strict";
import { isPublicAssetPath, isPublicPath } from "@/lib/security/public-paths";

assert.equal(isPublicAssetPath("/boot.html"), true);
assert.equal(isPublicAssetPath("/offline.html"), true);
assert.equal(isPublicAssetPath("/sw.js"), true);
assert.equal(isPublicAssetPath("/manifest.webmanifest"), true);
assert.equal(isPublicAssetPath("/icons/icon-192.png"), true);
assert.equal(isPublicAssetPath("/splash/apple-splash-750x1334.png"), true);
assert.equal(isPublicAssetPath("/budget"), false);
assert.equal(isPublicAssetPath("/login"), false);

assert.equal(isPublicPath("/boot.html"), true);
assert.equal(isPublicPath("/offline.html"), true);
assert.equal(isPublicPath("/login"), true);
assert.equal(isPublicPath("/invite/abc"), true);
assert.equal(isPublicPath("/auth/callback"), true);
assert.equal(isPublicPath("/"), true);
assert.equal(isPublicPath("/budget"), false);
assert.equal(isPublicPath("/passkey-setup"), false);
assert.equal(isPublicPath("/api/offline/snapshot"), false);

console.log("public-paths.test.ts: ok");
