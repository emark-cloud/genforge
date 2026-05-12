/**
 * Tiny helper that turns a `fetch` response's headers into the quota state
 * the FreeTierIndicator renders. The backend (src/lib/run-llm.ts) emits:
 *
 *   x-genforge-tier        → "free" | "byok"
 *   x-ratelimit-limit      → free-tier per-IP daily cap (free tier only)
 *   x-ratelimit-remaining  → free-tier remaining for the rest of the day
 *
 * BYOK responses omit the ratelimit headers entirely — those calls aren't
 * counted.
 */

export type Tier = "free" | "byok";

export type Quota = {
  /** Free-tier per-IP daily cap. */
  limit: number;
  /** How many free-tier calls this IP has left for the day after the most-recent response. */
  remaining: number;
};

export function tierFromHeaders(headers: Headers): Tier | null {
  const raw = headers.get("x-genforge-tier");
  if (raw === "free" || raw === "byok") return raw;
  return null;
}

export function readQuotaHeaders(headers: Headers): Quota | null {
  const limit = headers.get("x-ratelimit-limit");
  const remaining = headers.get("x-ratelimit-remaining");
  if (limit == null || remaining == null) return null;
  const lim = Number(limit);
  const rem = Number(remaining);
  if (!Number.isFinite(lim) || !Number.isFinite(rem)) return null;
  return { limit: lim, remaining: Math.max(0, rem) };
}
