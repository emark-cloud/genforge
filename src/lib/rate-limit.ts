/**
 * Free-tier rate limiting.
 *
 * Two layers stacked:
 *   1. Per-IP daily fixed window (`FREE_TIER_DAILY_LIMIT` requests/day/IP).
 *   2. Global daily caps:
 *        - request-count ceiling (`SERVER_LLM_DAILY_REQUEST_CAP`)
 *        - USD-estimate ceiling (`SERVER_LLM_DAILY_USD_CAP`)
 *
 * Both use UTC-midnight fixed windows so a single rollover resets
 * everything. Keys self-expire via TTL so we never need a cleanup job.
 *
 * The contract: callers MUST call `checkAndReserve()` before invoking
 * the LLM. If it returns `allow: false`, return the corresponding HTTP
 * status to the client. If it returns `allow: true`, call the LLM, then
 * — once you know the token usage — call `recordUsageCost()` to top up
 * the USD counter.
 */

import { getRedis, secondsUntilUtcMidnight, todayKey } from "./redis";

const DEFAULT_FREE_TIER_DAILY_LIMIT = 5;
const DEFAULT_GLOBAL_REQUEST_CAP = 500;
const DEFAULT_GLOBAL_USD_CAP = 5;

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envFloat(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type LimitDecision =
  | {
      allow: true;
      /** Requests remaining today for this IP. */
      ipRemaining: number;
      /** Per-IP daily cap. */
      ipLimit: number;
    }
  | {
      allow: false;
      reason: "per_ip" | "global_requests" | "global_usd";
      /** HTTP status the route should return. */
      status: 429;
      ipRemaining: number;
      ipLimit: number;
    };

/**
 * Reserves one request slot for `ipHash` on the free tier.
 *
 * Two counters are incremented sequentially (per-IP, then global). If a
 * cap is breached, the increment is rolled back so the limit was hit by
 * an earlier request, not us, and the counter doesn't sit inflated.
 */
export async function checkAndReserve(ipHash: string): Promise<LimitDecision> {
  const ipLimit = envInt("FREE_TIER_DAILY_LIMIT", DEFAULT_FREE_TIER_DAILY_LIMIT);
  const globalRequestCap = envInt(
    "SERVER_LLM_DAILY_REQUEST_CAP",
    DEFAULT_GLOBAL_REQUEST_CAP,
  );
  const globalUsdCap = envFloat(
    "SERVER_LLM_DAILY_USD_CAP",
    DEFAULT_GLOBAL_USD_CAP,
  );

  const redis = getRedis();
  const day = todayKey();
  const ttl = secondsUntilUtcMidnight();

  const ipKey = `ratelimit:ip:${ipHash}:${day}`;
  const reqKey = `ratelimit:global:requests:${day}`;
  const usdKey = `ratelimit:global:usd:${day}`;

  // USD ceiling is a soft estimate updated after each call; we don't
  // reserve against it, we just refuse new requests if it's already over.
  const usdRaw = await redis.get<string | number>(usdKey);
  const usdSoFar =
    typeof usdRaw === "number"
      ? usdRaw
      : usdRaw
        ? Number.parseFloat(String(usdRaw))
        : 0;
  if (Number.isFinite(usdSoFar) && usdSoFar >= globalUsdCap) {
    const current = (await redis.get<number>(ipKey)) ?? 0;
    return {
      allow: false,
      reason: "global_usd",
      status: 429,
      ipRemaining: Math.max(0, ipLimit - current),
      ipLimit,
    };
  }

  // Per-IP first — if this fails we don't even touch the global counter.
  const ipCount = await redis.incr(ipKey);
  await redis.expire(ipKey, ttl);
  if (ipCount > ipLimit) {
    await redis.decr(ipKey);
    return {
      allow: false,
      reason: "per_ip",
      status: 429,
      ipRemaining: 0,
      ipLimit,
    };
  }

  const reqCount = await redis.incr(reqKey);
  await redis.expire(reqKey, ttl);
  if (reqCount > globalRequestCap) {
    await redis.decr(ipKey);
    await redis.decr(reqKey);
    return {
      allow: false,
      reason: "global_requests",
      status: 429,
      ipRemaining: Math.max(0, ipLimit - (ipCount - 1)),
      ipLimit,
    };
  }

  return {
    allow: true,
    ipRemaining: Math.max(0, ipLimit - ipCount),
    ipLimit,
  };
}

/** Top up the global USD counter after a successful LLM call. The
 *  estimate is best-effort; we accept some drift in exchange for not
 *  blocking the request path on price-table lookups. */
export async function recordUsageCost(usd: number): Promise<void> {
  if (!Number.isFinite(usd) || usd <= 0) return;
  const redis = getRedis();
  const day = todayKey();
  const ttl = secondsUntilUtcMidnight();
  const key = `ratelimit:global:usd:${day}`;
  await redis.incrbyfloat(key, usd);
  await redis.expire(key, ttl);
}

/** Read-only view for the FreeTierIndicator component — does not
 *  consume a slot. */
export async function peekRemaining(ipHash: string): Promise<{
  ipRemaining: number;
  ipLimit: number;
}> {
  const ipLimit = envInt("FREE_TIER_DAILY_LIMIT", DEFAULT_FREE_TIER_DAILY_LIMIT);
  const redis = getRedis();
  const day = todayKey();
  const current =
    (await redis.get<number>(`ratelimit:ip:${ipHash}:${day}`)) ?? 0;
  return { ipRemaining: Math.max(0, ipLimit - current), ipLimit };
}
