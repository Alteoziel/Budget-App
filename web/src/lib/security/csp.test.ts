import assert from "node:assert/strict";
import { buildContentSecurityPolicy } from "@/lib/security/csp";

async function main() {
  const prod = buildContentSecurityPolicy("testnonce123", { isDev: false });
  assert.match(prod, /script-src[^;]*'nonce-testnonce123'/);
  assert.match(prod, /'strict-dynamic'/);
  assert.doesNotMatch(prod, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(prod, /script-src[^;]*'unsafe-eval'/);
  assert.match(prod, /style-src 'self' 'unsafe-inline'/);
  assert.match(prod, /https:\/\/cdn\.plaid\.com/);

  const dev = buildContentSecurityPolicy("devnonce", { isDev: true });
  assert.match(dev, /script-src[^;]*'unsafe-eval'/);

  console.log("csp.test.ts: ok");
}

void main();
