/**
 * The single brain shared by `/api/debug` and `/api/generate`.
 *
 * Per CLAUDE.md "Request routing", every call walks this same ladder:
 *
 *   1. validate the request body (size, shape)
 *   2. if BYOK → call the chosen provider directly (no caps, no breaker)
 *   3. else free tier:
 *        - breaker open?           → 503
 *        - over caps / per-IP?     → 429
 *        - reserve a slot, call Gemini Flash with the server key
 *        - on 5xx → bump the breaker
 *   4. parse JSON output (fence-strip fallback)
 *   5. log: ts, hashed IP, tier, provider, ok, tokens, latency. Never the
 *      prompt, response, or key.
 *   6. shape the response (JSON body + quota headers).
 */

import type { Flow } from "./system-prompt";
import {
  buildSystemPrompt,
  buildDebugUserPrompt,
  buildGenerateUserPrompt,
} from "./system-prompt";
import { getProvider, LLMError, type ProviderName } from "./providers";
import { PROVIDER_NAMES } from "./providers";
import {
  SERVER_DEFAULT_MODEL,
  DEFAULT_MODELS,
  MODEL_OPTIONS,
} from "./models";
import {
  checkAndReserve,
  peekRemaining,
  recordUsageCost,
} from "./rate-limit";
import { isOpen, openUntil, recordFailure } from "./circuit";
import { hashedIp } from "./ip";
import { log } from "./log";

// Soft caps. Anything larger is almost certainly noise (or abuse).
const MAX_CONTRACT_BYTES = 64 * 1024;
const MAX_DESCRIPTION_BYTES = 8 * 1024;
const MAX_ERROR_CONTEXT_BYTES = 8 * 1024;
const MAX_BYOK_KEY_BYTES = 512;

type Byok = {
  provider: ProviderName;
  key: string;
  model?: string;
};

export type DebugBody = {
  contract: string;
  errorContext?: string | null;
  byok?: Byok | null;
};

export type GenerateBody = {
  description: string;
  byok?: Byok | null;
};

export type RunResult = {
  status: number;
  body: Record<string, unknown>;
  /** Headers the route should attach to the response. */
  headers: Record<string, string>;
};

// ── Validation ─────────────────────────────────────────────────────────────

function isString(x: unknown): x is string {
  return typeof x === "string";
}

function byteLen(s: string): number {
  // TextEncoder length is the actual UTF-8 byte size. `s.length` would
  // underreport for non-ASCII.
  return new TextEncoder().encode(s).length;
}

function validateByok(b: unknown): { ok: true; byok: Byok | null } | { ok: false; status: 400; reason: string } {
  if (b == null) return { ok: true, byok: null };
  if (typeof b !== "object") return { ok: false, status: 400, reason: "byok must be an object" };
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
    if (!isString(o.model)) return { ok: false, status: 400, reason: "byok.model must be a string" };
    model = o.model;
  }
  return {
    ok: true,
    byok: { provider: o.provider as ProviderName, key: o.key, model },
  };
}

function validateDebugBody(raw: unknown):
  | { ok: true; body: DebugBody }
  | { ok: false; status: 400 | 413; reason: string } {
  if (raw == null || typeof raw !== "object") {
    return { ok: false, status: 400, reason: "body must be a JSON object" };
  }
  const o = raw as Record<string, unknown>;
  if (!isString(o.contract) || o.contract.trim().length === 0) {
    return { ok: false, status: 400, reason: "contract is required" };
  }
  if (byteLen(o.contract) > MAX_CONTRACT_BYTES) {
    return { ok: false, status: 413, reason: "contract too large" };
  }
  let errorContext: string | null | undefined = null;
  if (o.errorContext != null) {
    if (!isString(o.errorContext)) {
      return { ok: false, status: 400, reason: "errorContext must be a string" };
    }
    if (byteLen(o.errorContext) > MAX_ERROR_CONTEXT_BYTES) {
      return { ok: false, status: 413, reason: "errorContext too large" };
    }
    errorContext = o.errorContext;
  }
  const byok = validateByok(o.byok);
  if (!byok.ok) return byok;
  return { ok: true, body: { contract: o.contract, errorContext, byok: byok.byok } };
}

function validateGenerateBody(raw: unknown):
  | { ok: true; body: GenerateBody }
  | { ok: false; status: 400 | 413; reason: string } {
  if (raw == null || typeof raw !== "object") {
    return { ok: false, status: 400, reason: "body must be a JSON object" };
  }
  const o = raw as Record<string, unknown>;
  if (!isString(o.description) || o.description.trim().length === 0) {
    return { ok: false, status: 400, reason: "description is required" };
  }
  if (byteLen(o.description) > MAX_DESCRIPTION_BYTES) {
    return { ok: false, status: 413, reason: "description too large" };
  }
  const byok = validateByok(o.byok);
  if (!byok.ok) return byok;
  return { ok: true, body: { description: o.description, byok: byok.byok } };
}

// ── JSON parsing (fence-strip fallback) ───────────────────────────────────

function tryParseJson(raw: string): { ok: true; data: Record<string, unknown> } | { ok: false } {
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

// ── Quota response headers ────────────────────────────────────────────────

function quotaHeaders(
  tier: "free" | "byok",
  ipRemaining: number | null,
  ipLimit: number | null,
): Record<string, string> {
  const h: Record<string, string> = { "x-genforge-tier": tier };
  if (tier === "free" && ipRemaining != null && ipLimit != null) {
    h["x-ratelimit-limit"] = String(ipLimit);
    h["x-ratelimit-remaining"] = String(ipRemaining);
  }
  return h;
}

// ── Core ──────────────────────────────────────────────────────────────────

type Args =
  | { flow: "debug"; raw: unknown; headers: Headers }
  | { flow: "generate"; raw: unknown; headers: Headers };

export async function runLLM(args: Args): Promise<RunResult> {
  const t0 = Date.now();
  const flow: Flow = args.flow;

  // Validate the request body.
  const validated =
    args.flow === "debug" ? validateDebugBody(args.raw) : validateGenerateBody(args.raw);
  if (!validated.ok) {
    return {
      status: validated.status,
      body: { error: validated.reason },
      headers: { "x-genforge-tier": "n/a" },
    };
  }

  const body = validated.body;
  const userPrompt =
    args.flow === "debug"
      ? buildDebugUserPrompt({
          contract: (body as DebugBody).contract,
          errorContext: (body as DebugBody).errorContext ?? null,
        })
      : buildGenerateUserPrompt({ description: (body as GenerateBody).description });

  const systemPrompt = buildSystemPrompt(flow);

  // Hash IP up front — used by both tiers for logging, only by free tier
  // for rate-limit keying.
  let ipHash: string;
  try {
    ipHash = hashedIp(args.headers);
  } catch {
    return {
      status: 500,
      body: { error: "server misconfigured: IP_HASH_SALT missing" },
      headers: { "x-genforge-tier": "n/a" },
    };
  }

  // ─── BYOK path ──────────────────────────────────────────────────────────
  if (body.byok) {
    const provider = getProvider(body.byok.provider);
    const model =
      body.byok.model ||
      DEFAULT_MODELS[body.byok.provider] ||
      MODEL_OPTIONS[body.byok.provider][0];
    try {
      const result = await provider.generate({
        apiKey: body.byok.key,
        model,
        systemPrompt,
        userPrompt,
        responseFormat: "json",
      });
      const parsed = tryParseJson(result.text);
      const payload = parsed.ok
        ? parsed.data
        : { warning: "model returned non-JSON; raw text included", raw: result.text };
      log({
        event: "llm_success",
        ipHash,
        tier: "byok",
        flow,
        provider: body.byok.provider,
        model,
        ok: true,
        latencyMs: Date.now() - t0,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
      });
      return {
        status: 200,
        body: payload,
        headers: quotaHeaders("byok", null, null),
      };
    } catch (e) {
      const status = e instanceof LLMError ? (e.status ?? 502) : 502;
      const reason =
        e instanceof LLMError
          ? `${e.provider}_${e.status ?? "error"}`
          : "byok_unexpected";
      log({
        event: "llm_failure",
        ipHash,
        tier: "byok",
        flow,
        provider: body.byok.provider,
        model,
        ok: false,
        status,
        latencyMs: Date.now() - t0,
        reason,
      });
      return {
        status,
        body: {
          error:
            e instanceof LLMError
              ? `Your ${e.provider} key request failed (${e.status ?? "error"}).`
              : "Your provider request failed.",
        },
        headers: quotaHeaders("byok", null, null),
      };
    }
  }

  // ─── Free-tier path ─────────────────────────────────────────────────────
  const serverKey = process.env.SERVER_LLM_KEY;
  if (!serverKey) {
    return {
      status: 500,
      body: { error: "server misconfigured: SERVER_LLM_KEY missing" },
      headers: { "x-genforge-tier": "free" },
    };
  }

  if (await isOpen()) {
    const until = await openUntil();
    log({
      event: "circuit_block",
      ipHash,
      tier: "free",
      flow,
      ok: false,
      status: 503,
      reason: "breaker_open",
    });
    const remaining = await peekRemaining(ipHash).catch(() => null);
    return {
      status: 503,
      body: {
        error: "Free tier is temporarily paused while the provider recovers. Add your own key in Settings to continue.",
        retryAfter: until ? Math.max(1, Math.ceil((until - Date.now()) / 1000)) : undefined,
      },
      headers: {
        ...quotaHeaders("free", remaining?.ipRemaining ?? null, remaining?.ipLimit ?? null),
        ...(until ? { "retry-after": String(Math.max(1, Math.ceil((until - Date.now()) / 1000))) } : {}),
      },
    };
  }

  const reservation = await checkAndReserve(ipHash);
  if (!reservation.allow) {
    log({
      event: "rate_limit_block",
      ipHash,
      tier: "free",
      flow,
      ok: false,
      status: 429,
      reason: reservation.reason,
    });
    const userMessage =
      reservation.reason === "per_ip"
        ? "You've used today's free requests. Add your own key in Settings to continue."
        : "The free tier hit today's global limit. Add your own key in Settings to continue.";
    return {
      status: 429,
      body: { error: userMessage, reason: reservation.reason },
      headers: quotaHeaders("free", reservation.ipRemaining, reservation.ipLimit),
    };
  }

  const provider = getProvider("gemini");
  try {
    const result = await provider.generate({
      apiKey: serverKey,
      model: process.env.SERVER_LLM_MODEL || SERVER_DEFAULT_MODEL,
      systemPrompt,
      userPrompt,
      responseFormat: "json",
    });
    const parsed = tryParseJson(result.text);
    const payload = parsed.ok
      ? parsed.data
      : { warning: "model returned non-JSON; raw text included", raw: result.text };

    // Fire-and-forget USD top-up. Pricing wires in later; until then
    // this is a no-op (recordUsageCost ignores zero).
    void recordUsageCost(0);

    log({
      event: "llm_success",
      ipHash,
      tier: "free",
      flow,
      provider: "gemini",
      model: process.env.SERVER_LLM_MODEL || SERVER_DEFAULT_MODEL,
      ok: true,
      latencyMs: Date.now() - t0,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
    });
    return {
      status: 200,
      body: payload,
      headers: quotaHeaders("free", reservation.ipRemaining, reservation.ipLimit),
    };
  } catch (e) {
    const status = e instanceof LLMError ? (e.status ?? 502) : 502;
    if (status >= 500) {
      const tripped = await recordFailure();
      if (tripped) {
        log({ event: "circuit_open", tier: "free", flow, ok: false, reason: "threshold_reached" });
      }
    }
    log({
      event: "llm_failure",
      ipHash,
      tier: "free",
      flow,
      provider: "gemini",
      model: process.env.SERVER_LLM_MODEL || SERVER_DEFAULT_MODEL,
      ok: false,
      status,
      latencyMs: Date.now() - t0,
      reason: e instanceof LLMError ? `gemini_${e.status ?? "error"}` : "free_unexpected",
    });
    return {
      status: status >= 500 ? 503 : status,
      body: {
        error:
          status >= 500
            ? "The free tier is having trouble reaching the provider. Try again in a minute or add your own key."
            : "The free-tier request failed.",
      },
      headers: quotaHeaders("free", reservation.ipRemaining, reservation.ipLimit),
    };
  }
}
