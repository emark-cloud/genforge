/**
 * Circuit breaker for the free-tier provider (Gemini Flash).
 *
 * Behavior:
 *   - We record a failure every time the server-side provider returns a
 *     5xx. Failures are bucketed into a 5-minute sliding window via a
 *     sorted set keyed by timestamp.
 *   - If the window has 3 or more failures, we OPEN the breaker for 1h.
 *   - While open, `isOpen()` returns true and the route returns 503.
 *
 * BYOK calls don't touch the breaker — the breaker exists to protect us
 * from spending the free-tier budget against a provider that's down.
 */

import { getRedis } from "./redis";

const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const THRESHOLD = 3;
const OPEN_DURATION_MS = 60 * 60 * 1000; // 1 hour

const FAILURES_KEY = "circuit:failures";
const OPEN_UNTIL_KEY = "circuit:open_until";

/** Returns the unix-ms timestamp the breaker opens until, or null if
 *  closed. Reading this is the only check the request path needs. */
export async function openUntil(): Promise<number | null> {
  const redis = getRedis();
  const raw = await redis.get<string | number>(OPEN_UNTIL_KEY);
  if (raw == null) return null;
  const ts = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(ts)) return null;
  if (ts <= Date.now()) {
    // Stale lock — let it sit; TTL will clean it up. We just report closed.
    return null;
  }
  return ts;
}

export async function isOpen(): Promise<boolean> {
  return (await openUntil()) !== null;
}

/**
 * Record a provider 5xx. If the sliding window now contains
 * `THRESHOLD` or more failures, open the breaker.
 *
 * Returns true if this call tripped the breaker (so the caller can log
 * the transition exactly once).
 */
export async function recordFailure(): Promise<boolean> {
  const redis = getRedis();
  const now = Date.now();

  // Append this failure to the sorted set scored by timestamp; the
  // member needs to be unique so concurrent calls don't dedupe — append
  // a random suffix.
  const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  await redis.zadd(FAILURES_KEY, { score: now, member });
  // Keep only entries from the last window; older entries are noise.
  await redis.zremrangebyscore(FAILURES_KEY, 0, now - WINDOW_MS);
  // TTL slightly larger than the window so the key cleans itself up
  // during quiet periods.
  await redis.expire(FAILURES_KEY, Math.ceil((WINDOW_MS / 1000) * 2));

  const count = await redis.zcard(FAILURES_KEY);
  if (count >= THRESHOLD) {
    const until = now + OPEN_DURATION_MS;
    // NX so we don't extend an already-open breaker on every failure.
    const set = await redis.set(OPEN_UNTIL_KEY, until, {
      nx: true,
      px: OPEN_DURATION_MS,
    });
    return set === "OK";
  }
  return false;
}

/** Test-only / admin escape hatch — clears the breaker state. Not
 *  exposed via any HTTP route. */
export async function resetBreaker(): Promise<void> {
  const redis = getRedis();
  await redis.del(FAILURES_KEY);
  await redis.del(OPEN_UNTIL_KEY);
}
