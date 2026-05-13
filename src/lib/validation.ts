/**
 * Shared request-validation primitives for the /api/* routes.
 *
 * Extracted from run-llm.ts so run-scan.ts can reuse the same Byok parsing,
 * byte caps, and JSON-with-fence-strip fallback without copy-paste drift.
 */

import { PROVIDER_NAMES, type ProviderName } from "./providers";

// ── Byte caps ─────────────────────────────────────────────────────────────

export const MAX_CONTRACT_BYTES = 64 * 1024;
export const MAX_DESCRIPTION_BYTES = 8 * 1024;
export const MAX_ERROR_CONTEXT_BYTES = 8 * 1024;
export const MAX_BYOK_KEY_BYTES = 512;
export const MAX_ATTEMPT_EXPLANATION_BYTES = 4 * 1024;

// ── Byok ──────────────────────────────────────────────────────────────────

export type Byok = {
  provider: ProviderName;
  key: string;
  model?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────

export function isString(x: unknown): x is string {
  return typeof x === "string";
}

export function byteLen(s: string): number {
  // TextEncoder length is the actual UTF-8 byte size. `s.length` would
  // underreport for non-ASCII.
  return new TextEncoder().encode(s).length;
}

export function validateByok(
  b: unknown,
):
  | { ok: true; byok: Byok | null }
  | { ok: false; status: 400; reason: string } {
  if (b == null) return { ok: true, byok: null };
  if (typeof b !== "object")
    return { ok: false, status: 400, reason: "byok must be an object" };
  const o = b as Record<string, unknown>;
  if (!isString(o.provider) || !PROVIDER_NAMES.includes(o.provider as ProviderName)) {
    return { ok: false, status: 400, reason: "byok.provider invalid" };
  }
  if (!isString(o.key) || o.key.trim().length === 0) {
    return { ok: false, status: 400, reason: "byok.key required" };
  }
  if (byteLen(o.key) > MAX_BYOK_KEY_BYTES) {
    return { ok: false, status: 400, reason: "byok.key too large" };
  }
  let model: string | undefined;
  if (o.model !== undefined) {
    if (!isString(o.model))
      return { ok: false, status: 400, reason: "byok.model must be a string" };
    model = o.model;
  }
  return {
    ok: true,
    byok: { provider: o.provider as ProviderName, key: o.key, model },
  };
}

// ── JSON parsing (fence-strip fallback) ──────────────────────────────────

export function tryParseJson(
  raw: string,
): { ok: true; data: Record<string, unknown> } | { ok: false } {
  // 1: plain parse.
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return { ok: true, data: v as Record<string, unknown> };
    }
  } catch {
    /* fall through */
  }
  // 2: strip ```json fences, slice between first { and last }.
  let s = raw.trim().replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try {
    const v = JSON.parse(s);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return { ok: true, data: v as Record<string, unknown> };
    }
  } catch {
    /* give up */
  }
  return { ok: false };
}
