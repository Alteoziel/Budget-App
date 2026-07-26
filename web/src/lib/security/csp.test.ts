import assert from "node:assert/strict";
import { buildContentSecurityPolicy } from "@/lib/security/csp";

async function main() {
  const prod = buildContentSecurityPolicy("testnonce123", { isDev: false });
  const prodScript = prod
    .split("; ")
    .find((part) => part.startsWith("script-src "));
  assert.ok(prodScript, "expected script-src directive");
  assert.match(prodScript, /'nonce-testnonce123'/);
  assert.match(prodScript, /'strict-dynamic'/);
  assert.doesNotMatch(prodScript, /'unsafe-inline'/);
  assert.doesNotMatch(prodScript, /'unsafe-eval'/);
  // Anchored CSP token check (not URL sanitization).
  assert.match(prodScript, /(^|\s)https:\/\/cdn\.plaid\.com(\s|$)/);

  const prodStyle = prod
    .split("; ")
    .find((part) => part.startsWith("style-src "));
  assert.equal(prodStyle, "style-src 'self' 'unsafe-inline'");

  const dev = buildContentSecurityPolicy("devnonce", { isDev: true });
  const devScript = dev
    .split("; ")
    .find((part) => part.startsWith("script-src "));
  assert.ok(devScript, "expected script-src directive");
  assert.match(devScript, /'unsafe-eval'/);

  console.log("csp.test.ts: ok");
}

void main();
