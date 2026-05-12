/**
 * Headless verification for src/lib/quota.ts and the `isExhausted` predicate
 * from FreeTierIndicator. Pure functions — no DOM, no network.
 *
 * Run:
 *   pnpm dlx tsx scripts/check-quota.ts
 */

import { readQuotaHeaders, tierFromHeaders } from "../src/lib/quota";
import { isExhausted } from "../src/components/FreeTierIndicator";
import type { ActiveByok } from "../src/lib/keys";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok — ${msg}`);
}

function h(entries: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(entries)) h.set(k, v);
  return h;
}

const byok: ActiveByok = {
  provider: "anthropic",
  key: "sk-ant-x",
  model: "claude-opus-4-7",
};

// [1] tierFromHeaders
console.log("[1] tierFromHeaders");
assert(tierFromHeaders(h({ "x-genforge-tier": "free" })) === "free", "free");
assert(tierFromHeaders(h({ "x-genforge-tier": "byok" })) === "byok", "byok");
assert(tierFromHeaders(h({ "x-genforge-tier": "n/a" })) === null, "n/a returns null");
assert(tierFromHeaders(h({})) === null, "missing returns null");

// [2] readQuotaHeaders
console.log("\n[2] readQuotaHeaders");
const q1 = readQuotaHeaders(
  h({ "x-genforge-tier": "free", "x-ratelimit-limit": "5", "x-ratelimit-remaining": "3" }),
);
assert(q1?.limit === 5 && q1?.remaining === 3, "free response → {5, 3}");

const q2 = readQuotaHeaders(
  h({ "x-ratelimit-limit": "5", "x-ratelimit-remaining": "-1" }),
);
assert(q2?.remaining === 0, "negative remaining clamps to 0");

assert(readQuotaHeaders(h({})) === null, "missing both → null");
assert(
  readQuotaHeaders(h({ "x-ratelimit-limit": "abc", "x-ratelimit-remaining": "0" })) === null,
  "non-numeric → null",
);

// BYOK response has no ratelimit headers
assert(readQuotaHeaders(h({ "x-genforge-tier": "byok" })) === null, "BYOK headers → null quota");

// [3] isExhausted
console.log("\n[3] isExhausted");
assert(isExhausted(null, null) === false, "no quota yet → not exhausted (defaults to allowed)");
assert(isExhausted(null, { limit: 5, remaining: 1 }) === false, "1 left → not exhausted");
assert(isExhausted(null, { limit: 5, remaining: 0 }) === true, "0 left → exhausted");
assert(isExhausted(byok, { limit: 5, remaining: 0 }) === false, "BYOK overrides exhausted quota");
assert(isExhausted(byok, null) === false, "BYOK is never exhausted");

console.log("\n# all quota checks passed");
