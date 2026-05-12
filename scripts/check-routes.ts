/**
 * End-to-end route verification for Step 6.
 *
 * Spins up nothing on its own — assumes `pnpm dev` is running on
 * http://localhost:3000. Exercises:
 *
 *   1. malformed JSON body                    → 400
 *   2. empty/missing required fields          → 400
 *   3. oversized field                        → 413
 *   4. happy path debug (free tier)           → 200, JSON shape
 *   5. happy path generate (free tier)        → 200, JSON shape
 *   6. quota headers present + decreasing
 *
 * Cleans the test IP's daily counter before running so subsequent runs
 * are reproducible. Uses a deterministic x-forwarded-for so this run
 * doesn't burn the developer's IP quota.
 *
 * Run:
 *   pnpm dlx tsx --env-file=.env.local scripts/check-routes.ts
 */

import { hashedIpFromString } from "../src/lib/ip";
import { getRedis, todayKey } from "../src/lib/redis";
import { resetBreaker } from "../src/lib/circuit";

const BASE = process.env.GENFORGE_BASE_URL || "http://localhost:3000";
const TEST_IP = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok — ${msg}`);
}

async function call(
  path: string,
  body: unknown,
  opts: { contentType?: string } = {},
): Promise<{ status: number; json: Record<string, unknown> | null; headers: Headers; text: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": opts.contentType ?? "application/json",
      "x-forwarded-for": TEST_IP,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave null */
  }
  return { status: res.status, json, headers: res.headers, text };
}

const BROKEN_CONTRACT = `# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import gl

class Counter(gl.Contract):
    count: float  # bug: floats not allowed in storage

    def __init__(self):
        self.count = 0.0

    @gl.public.write
    def increment(self):
        self.count += 1.0
`;

async function reset() {
  const ipHash = hashedIpFromString(TEST_IP);
  const redis = getRedis();
  const day = todayKey();
  await redis.del(`ratelimit:ip:${ipHash}:${day}`);
  await redis.del(`ratelimit:global:requests:${day}`);
  await redis.del(`ratelimit:global:usd:${day}`);
  await resetBreaker();
}

async function main() {
  // Confirm the server is reachable.
  try {
    await fetch(BASE);
  } catch {
    console.error(
      `Cannot reach ${BASE}. Start the dev server first: pnpm dev (in another shell).`,
    );
    process.exit(1);
  }

  await reset();
  console.log(`# route verification — base=${BASE}, test ip=${TEST_IP}\n`);

  // [1] malformed JSON body
  console.log("[1] malformed JSON body");
  const r1 = await call("/api/debug", "{ not valid json");
  assert(r1.status === 400, "malformed JSON → 400");
  assert(r1.json?.error != null, "malformed JSON → error message");

  // [2] missing required fields
  console.log("\n[2] missing required fields");
  const r2a = await call("/api/debug", {});
  assert(r2a.status === 400, "empty body → 400 (debug)");
  const r2b = await call("/api/debug", { contract: "   " });
  assert(r2b.status === 400, "whitespace-only contract → 400");
  const r2c = await call("/api/generate", { description: "" });
  assert(r2c.status === 400, "empty description → 400 (generate)");

  // [3] oversized field
  console.log("\n[3] oversized field");
  const tooBig = "x".repeat(65 * 1024);
  const r3 = await call("/api/debug", { contract: tooBig });
  assert(r3.status === 413, "65KB contract → 413");

  // [4] happy path debug
  console.log("\n[4] happy path debug (free tier)");
  const r4 = await call("/api/debug", {
    contract: BROKEN_CONTRACT,
    errorContext: "the deployer rejected the contract; not sure why",
  });
  if (r4.status !== 200) {
    console.log(`  (got ${r4.status} from /api/debug — full body:)`);
    console.log(`  ${r4.text.slice(0, 400)}`);
  }
  assert(r4.status === 200, "debug → 200");
  assert(r4.headers.get("x-genforge-tier") === "free", "tier header = free");
  assert(r4.headers.get("x-ratelimit-limit") != null, "ratelimit-limit header present");
  assert(r4.headers.get("x-ratelimit-remaining") != null, "ratelimit-remaining header present");
  if (r4.json?.warning) {
    console.log(`  note: model returned non-JSON fallback path: ${String(r4.json.warning)}`);
  } else {
    assert(typeof r4.json?.fixed_code === "string", "debug body.fixed_code is string");
    assert(typeof r4.json?.explanation === "string", "debug body.explanation is string");
    assert(Array.isArray(r4.json?.changes), "debug body.changes is array");
  }
  const remainingAfter1 = Number(r4.headers.get("x-ratelimit-remaining"));

  // [5] happy path generate
  console.log("\n[5] happy path generate (free tier)");
  const r5 = await call("/api/generate", {
    description:
      "a simple voting contract: any address can vote yes or no on a numeric proposal id; expose a tally view",
  });
  if (r5.status !== 200) {
    console.log(`  (got ${r5.status} from /api/generate — full body:)`);
    console.log(`  ${r5.text.slice(0, 400)}`);
  }
  assert(r5.status === 200, "generate → 200");
  if (r5.json?.warning) {
    console.log(`  note: model returned non-JSON fallback path: ${String(r5.json.warning)}`);
  } else {
    assert(typeof r5.json?.code === "string", "generate body.code is string");
    assert(typeof r5.json?.usage_notes === "string", "generate body.usage_notes is string");
    assert(Array.isArray(r5.json?.constructor_args), "generate body.constructor_args is array");
  }
  const remainingAfter2 = Number(r5.headers.get("x-ratelimit-remaining"));
  assert(remainingAfter2 < remainingAfter1, "quota decreased between calls");

  await reset();
  console.log("\n# all route checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
