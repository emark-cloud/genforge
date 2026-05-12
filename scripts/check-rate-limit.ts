/**
 * End-to-end verification for Step 5.
 *
 * Exercises rate-limit, circuit-breaker, and ip/log helpers against the
 * real Upstash instance configured in .env.local. Cleans up its own
 * keys before and after so it can be re-run idempotently.
 *
 * Run:
 *   pnpm dlx tsx --env-file=.env.local scripts/check-rate-limit.ts
 */

import {
  checkAndReserve,
  peekRemaining,
  recordUsageCost,
} from "../src/lib/rate-limit";
import {
  isOpen,
  openUntil,
  recordFailure,
  resetBreaker,
} from "../src/lib/circuit";
import { hashedIpFromString } from "../src/lib/ip";
import { log } from "../src/lib/log";
import { getRedis, todayKey } from "../src/lib/redis";

const TEST_IP = `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok — ${msg}`);
}

async function clean(ipHash: string) {
  const redis = getRedis();
  const day = todayKey();
  await redis.del(`ratelimit:ip:${ipHash}:${day}`);
  await redis.del(`ratelimit:global:requests:${day}`);
  await redis.del(`ratelimit:global:usd:${day}`);
  await resetBreaker();
}

async function main() {
  const original = {
    FREE_TIER_DAILY_LIMIT: process.env.FREE_TIER_DAILY_LIMIT,
    SERVER_LLM_DAILY_REQUEST_CAP: process.env.SERVER_LLM_DAILY_REQUEST_CAP,
    SERVER_LLM_DAILY_USD_CAP: process.env.SERVER_LLM_DAILY_USD_CAP,
  };

  const ipHash = hashedIpFromString(TEST_IP);
  console.log(`# rate-limit + circuit verification`);
  console.log(`# synthetic ip: ${TEST_IP}`);
  console.log(`# ipHash[0..12]: ${ipHash.slice(0, 12)}…\n`);

  // -------- Suite 1: per-IP daily limit --------
  console.log("[1] per-IP daily limit");
  process.env.FREE_TIER_DAILY_LIMIT = "2";
  process.env.SERVER_LLM_DAILY_REQUEST_CAP = "1000";
  process.env.SERVER_LLM_DAILY_USD_CAP = "1000";
  await clean(ipHash);

  const d1 = await checkAndReserve(ipHash);
  assert(d1.allow === true, "1st call allowed");
  assert(d1.allow && d1.ipRemaining === 1, "1st call ipRemaining=1");

  const d2 = await checkAndReserve(ipHash);
  assert(d2.allow === true, "2nd call allowed");
  assert(d2.allow && d2.ipRemaining === 0, "2nd call ipRemaining=0");

  const d3 = await checkAndReserve(ipHash);
  assert(d3.allow === false, "3rd call blocked");
  assert(!d3.allow && d3.reason === "per_ip", "3rd call reason=per_ip");
  assert(!d3.allow && d3.status === 429, "3rd call status=429");

  const peek = await peekRemaining(ipHash);
  assert(peek.ipRemaining === 0 && peek.ipLimit === 2, "peek reflects state");

  // -------- Suite 2: global request cap --------
  console.log("\n[2] global request cap");
  process.env.FREE_TIER_DAILY_LIMIT = "100";
  process.env.SERVER_LLM_DAILY_REQUEST_CAP = "1";
  process.env.SERVER_LLM_DAILY_USD_CAP = "1000";
  await clean(ipHash);

  const g1 = await checkAndReserve(ipHash);
  assert(g1.allow === true, "global cap=1: 1st call allowed");
  const g2 = await checkAndReserve(ipHash);
  assert(g2.allow === false, "global cap=1: 2nd call blocked");
  assert(
    !g2.allow && g2.reason === "global_requests",
    "global cap: reason=global_requests",
  );

  // -------- Suite 3: global USD cap --------
  console.log("\n[3] global USD cap");
  process.env.FREE_TIER_DAILY_LIMIT = "100";
  process.env.SERVER_LLM_DAILY_REQUEST_CAP = "100";
  process.env.SERVER_LLM_DAILY_USD_CAP = "0.10";
  await clean(ipHash);

  await recordUsageCost(0.15); // already over the 0.10 cap
  const u1 = await checkAndReserve(ipHash);
  assert(u1.allow === false, "USD cap: blocked when over");
  assert(!u1.allow && u1.reason === "global_usd", "USD cap: reason=global_usd");

  process.env.SERVER_LLM_DAILY_USD_CAP = "100"; // raise cap, request now allowed
  const u2 = await checkAndReserve(ipHash);
  assert(u2.allow === true, "USD cap: allowed when under");

  // -------- Suite 4: circuit breaker --------
  console.log("\n[4] circuit breaker");
  await resetBreaker();
  assert((await isOpen()) === false, "breaker starts closed");
  const t1 = await recordFailure();
  const t2 = await recordFailure();
  assert(!t1 && !t2, "first two failures don't trip");
  assert((await isOpen()) === false, "breaker still closed after 2 failures");
  const t3 = await recordFailure();
  assert(t3 === true, "3rd failure trips the breaker");
  assert((await isOpen()) === true, "breaker now open");
  const until = await openUntil();
  assert(
    until !== null && until > Date.now() + 50 * 60 * 1000,
    "breaker open for ~1h",
  );
  // Subsequent failures shouldn't extend (NX lock).
  const t4 = await recordFailure();
  assert(t4 === false, "4th failure does not re-trip (NX)");
  await resetBreaker();
  assert((await isOpen()) === false, "breaker closes after reset");

  // -------- Suite 5: structured log --------
  console.log("\n[5] structured log");
  log({
    event: "llm_success",
    flow: "debug",
    provider: "gemini",
    model: "gemini-2.5-flash",
    tier: "free",
    ok: true,
    latencyMs: 1234,
    inputTokens: 41,
    outputTokens: 18,
  });
  // The Forbidden type prevents adding `prompt` / `response` / `apiKey`
  // at the type level — that's a compile-time guarantee, not a runtime
  // assertion. The successful tsc --noEmit run is the verification.
  console.log("  ok — log emitted JSON line");

  // -------- Cleanup --------
  await clean(ipHash);
  process.env.FREE_TIER_DAILY_LIMIT = original.FREE_TIER_DAILY_LIMIT;
  process.env.SERVER_LLM_DAILY_REQUEST_CAP = original.SERVER_LLM_DAILY_REQUEST_CAP;
  process.env.SERVER_LLM_DAILY_USD_CAP = original.SERVER_LLM_DAILY_USD_CAP;

  console.log("\n# all checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
