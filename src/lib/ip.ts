/**
 * Client IP extraction + hashing.
 *
 * On Vercel (and any sensible proxy), the real client IP is the first
 * hop of `x-forwarded-for`. Everything after is the proxy chain. We
 * never trust `x-real-ip` from arbitrary upstreams.
 *
 * IPs are hashed with sha256 + IP_HASH_SALT before they're used as
 * rate-limit keys or sent to logs. The plaintext IP never leaves this
 * module.
 */

import { createHash } from "node:crypto";

const FALLBACK = "0.0.0.0";

function rawIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xrip = headers.get("x-real-ip");
  if (xrip) return xrip.trim();
  return FALLBACK;
}

/** Hashed-per-day-ish identifier used everywhere downstream. Hashing is
 *  one-way; collisions across the user base are astronomically rare
 *  given a 64-char random salt. */
export function hashedIp(headers: Headers): string {
  const salt = process.env.IP_HASH_SALT;
  if (!salt) {
    throw new Error("IP_HASH_SALT must be set");
  }
  return createHash("sha256").update(salt).update(rawIp(headers)).digest("hex");
}

/** For unit tests / scripts where we don't have a real `Headers`. */
export function hashedIpFromString(ip: string): string {
  const salt = process.env.IP_HASH_SALT;
  if (!salt) throw new Error("IP_HASH_SALT must be set");
  return createHash("sha256").update(salt).update(ip).digest("hex");
}
