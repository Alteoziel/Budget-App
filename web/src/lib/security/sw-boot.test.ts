import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sw = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
const boot = readFileSync(join(process.cwd(), "public/boot.html"), "utf8");

assert.match(sw, /const VERSION = "v13"/);
assert.match(sw, /path === "\/boot\.html"/);
assert.match(sw, /BOOT_SHELL_HTML/);
assert.doesNotMatch(sw, /caches\.match\("\/boot\.html"\)/);
assert.match(
  sw,
  /Password \/ passkey \/ invite \/ magic-link \/ boot\+offline shells/,
);

assert.match(boot, /path === "\/boot\.html"/);
assert.match(boot, /location\.replace\("\/budget"\)/);
assert.match(boot, /X-Alte-Boot/);

console.log("sw-boot.test.ts: ok");
