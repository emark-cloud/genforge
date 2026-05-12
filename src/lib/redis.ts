/**
 * Shared Upstash Redis REST client. All rate-limit, breaker, and counter
 * state goes through this single instance so connection settings live in
 * one place and we don't accidentally create per-request clients.
 */

import { Redis } from "@upstash/redis";

let cached: Redis | null = null;

export function getRedis(): Redis {
  if (cached) return cached;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set",
    );
  }
  cached = new Redis({ url, token });
  return cached;
}

/** UTC YYYY-MM-DD — the key suffix every daily counter shares so a single
 *  midnight-UTC rollover resets everything cleanly. */
export function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Seconds remaining until the next UTC midnight. Used as the TTL on
 *  daily counters so they self-expire instead of leaking. */
export function secondsUntilUtcMidnight(now: Date = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(60, Math.ceil((next.getTime() - now.getTime()) / 1000));
}
