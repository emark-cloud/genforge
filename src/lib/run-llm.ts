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

import type { DebugAttempt, Flow } from "./system-prompt";
import {
  buildSystemPrompt,
  buildDebugUserPrompt,
  buildGenerateUserPrompt,
} from "./system-prompt";
import { getProvider, LLMError, type ProviderName } from "./providers";
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
import {
  formatLintForPrompt,
  lintContract,
  summarize as summarizeLint,
  type LintResult,
} from "./lint";
import {
  byteLen,
  isString,
  tryParseJson,
  validateByok,
  type Byok,
  MAX_CONTRACT_BYTES,
  MAX_DESCRIPTION_BYTES,
  MAX_ERROR_CONTEXT_BYTES,
  MAX_ATTEMPT_EXPLANATION_BYTES,
} from "./validation";

// Latency floor — if we've already burned this much before post-flight,
// we skip the retry to leave room for the response itself under Vercel's
// 60s function cap (see `maxDuration` on the routes).
const RETRY_DEADLINE_MS = 35_000;

type ProviderCall = (userPromptOverride: string) => Promise<{
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}>;

export type DebugBody = {
  contract: string;
  errorContext?: string | null;
  /** Refix chain. Each entry is one prior iteration of (error → fix). The
   * most recent entry's `fixed_code` is the candidate that failed in Studio
   * and is what the model is asked to revise. */
  priorAttempts?: DebugAttempt[] | null;
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

function validatePriorAttempts(raw: unknown):
  | { ok: true; priorAttempts: DebugAttempt[] }
  | { ok: false; status: 400 | 413; reason: string } {
  if (raw == null) return { ok: true, priorAttempts: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, status: 400, reason: "priorAttempts must be an array" };
  }
  // No hard length cap — the prompt-side trim ladder (system-prompt.ts)
  // degrades older entries gracefully. Per-entry byte caps below still apply.
  const out: DebugAttempt[] = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (v == null || typeof v !== "object") {
      return { ok: false, status: 400, reason: `priorAttempts[${i}] must be an object` };
    }
    const o = v as Record<string, unknown>;
    if (!isString(o.fixed_code) || o.fixed_code.length === 0) {
      return { ok: false, status: 400, reason: `priorAttempts[${i}].fixed_code required` };
    }
    if (byteLen(o.fixed_code) > MAX_CONTRACT_BYTES) {
      return { ok: false, status: 413, reason: `priorAttempts[${i}].fixed_code too large` };
    }
    if (!isString(o.explanation)) {
      return { ok: false, status: 400, reason: `priorAttempts[${i}].explanation must be a string` };
    }
    if (byteLen(o.explanation) > MAX_ATTEMPT_EXPLANATION_BYTES) {
      return { ok: false, status: 413, reason: `priorAttempts[${i}].explanation too large` };
    }
    if (!isString(o.error)) {
      return { ok: false, status: 400, reason: `priorAttempts[${i}].error must be a string` };
    }
    if (byteLen(o.error) > MAX_ERROR_CONTEXT_BYTES) {
      return { ok: false, status: 413, reason: `priorAttempts[${i}].error too large` };
    }
    out.push({ fixed_code: o.fixed_code, explanation: o.explanation, error: o.error });
  }
  return { ok: true, priorAttempts: out };
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
  const prior = validatePriorAttempts(o.priorAttempts);
  if (!prior.ok) return prior;
  const byok = validateByok(o.byok);
  if (!byok.ok) return byok;
  return {
    ok: true,
    body: {
      contract: o.contract,
      errorContext,
      priorAttempts: prior.priorAttempts.length > 0 ? prior.priorAttempts : null,
      byok: byok.byok,
    },
  };
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

// ── Lint integration helpers ──────────────────────────────────────────────

function combineErrorContext(
  orig: string | null | undefined,
  preLint: LintResult | null,
): string | null {
  const trimmed = orig?.trim() ?? "";
  if (!preLint || (preLint.errors.length === 0 && preLint.warnings.length === 0)) {
    return trimmed.length > 0 ? trimmed : null;
  }
  const block = formatLintForPrompt(preLint);
  return trimmed.length > 0 ? `${trimmed}\n\n${block}` : block;
}

function extractCode(payload: Record<string, unknown>, flow: Flow): string | null {
  const key = flow === "debug" ? "fixed_code" : "code";
  const v = payload[key];
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

const RETRY_INSTRUCTION =
  "\n\nThe lint findings above were detected on your previous output. " +
  "Revise the contract to eliminate every ERROR (and address WARNINGS where reasonable). " +
  "Re-emit the FULL JSON object per the original schema — do not drop fields, do not add prose.";

/**
 * Run a single retry against the same provider with lint findings appended
 * to the user prompt. The retry shares the original rate-limit reservation
 * (no new ticket pulled) and never trips the free-tier circuit breaker on
 * failure — the first call already succeeded; lint-driven retry is a quality
 * pass, not a reliability signal.
 *
 * Returns the better of the two attempts; `retryUsage` is set only when the
 * retry actually replaced the original payload.
 */
async function maybeRetry(args: {
  flow: Flow;
  callProvider: ProviderCall;
  userPrompt: string;
  payload: Record<string, unknown>;
  postLint: LintResult;
  t0: number;
  ipHash: string;
  tier: "free" | "byok";
  provider: ProviderName;
  model: string;
}): Promise<{
  payload: Record<string, unknown>;
  postLint: LintResult;
  retryUsage?: { inputTokens?: number; outputTokens?: number };
}> {
  const { flow, callProvider, userPrompt, payload, postLint, t0, ipHash, tier, provider, model } = args;
  if (postLint.errors.length === 0) return { payload, postLint };
  if (Date.now() - t0 >= RETRY_DEADLINE_MS) {
    log({ event: "llm_retry", ipHash, tier, flow, provider, model, ok: false, reason: "no_time" });
    return { payload, postLint };
  }
  const retryPrompt = userPrompt + "\n\n" + formatLintForPrompt(postLint) + RETRY_INSTRUCTION;
  try {
    const retry = await callProvider(retryPrompt);
    const retryParsed = tryParseJson(retry.text);
    if (!retryParsed.ok) {
      log({ event: "llm_retry", ipHash, tier, flow, provider, model, ok: false, reason: "retry_parse" });
      return { payload, postLint };
    }
    const retryCode = extractCode(retryParsed.data, flow);
    const retryLint = retryCode ? await lintContract(retryCode, { stage: "post" }) : null;
    if (retryLint && retryLint.errors.length < postLint.errors.length) {
      log({
        event: "llm_retry",
        ipHash, tier, flow, provider, model,
        ok: true,
        errorCount: retryLint.errors.length,
        warnCount: retryLint.warnings.length,
      });
      return { payload: retryParsed.data, postLint: retryLint, retryUsage: retry.usage };
    }
    log({
      event: "llm_retry",
      ipHash, tier, flow, provider, model,
      ok: false,
      reason: "no_improvement",
      errorCount: retryLint?.errors.length,
    });
    return { payload, postLint };
  } catch {
    // Swallow — the first attempt already succeeded; a failed retry doesn't
    // change the user's outcome. Don't touch the circuit breaker either.
    log({ event: "llm_retry", ipHash, tier, flow, provider, model, ok: false, reason: "retry_throw" });
    return { payload, postLint };
  }
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
  const systemPrompt = buildSystemPrompt(flow);

  // Pre-flight lint on the user-pasted contract (debug only). When this is a
  // refix iteration, lint the *latest candidate that failed in Studio*, not
  // the original paste — that's the code the model is being asked to revise.
  // Findings are folded into the LLM's error context so the model has the
  // same signal a careful reviewer would. lintContract returns null on any
  // failure mode (no URL, timeout, etc.) — pre-lint is purely additive.
  const debugBody = args.flow === "debug" ? (body as DebugBody) : null;
  const priorAttempts = debugBody?.priorAttempts ?? null;
  const preLintTarget =
    debugBody == null
      ? null
      : priorAttempts && priorAttempts.length > 0
        ? priorAttempts[priorAttempts.length - 1].fixed_code
        : debugBody.contract;
  const preLint = preLintTarget
    ? await lintContract(preLintTarget, { stage: "pre" })
    : null;

  let promptTrim: ReturnType<typeof buildDebugUserPrompt>["trim"] = null;
  let userPrompt: string;
  if (args.flow === "debug" && debugBody) {
    const built = buildDebugUserPrompt({
      contract: debugBody.contract,
      errorContext: combineErrorContext(debugBody.errorContext, preLint),
      priorAttempts,
    });
    userPrompt = built.prompt;
    promptTrim = built.trim;
  } else {
    userPrompt = buildGenerateUserPrompt({
      description: (body as GenerateBody).description,
    });
  }

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

  // Surface refix prompt trim events (counts only, never source) before we
  // commit to either tier — the trim is independent of where we route the
  // call.
  if (promptTrim) {
    log({
      event: "debug_prompt_trim",
      ipHash,
      flow,
      attemptCount: promptTrim.attemptCount,
      bytesBefore: promptTrim.bytesBefore,
      bytesAfter: promptTrim.bytesAfter,
      level: promptTrim.level,
    });
  }

  const attemptIndex = priorAttempts?.length ?? 0;

  // ─── BYOK path ──────────────────────────────────────────────────────────
  if (body.byok) {
    const provider = getProvider(body.byok.provider);
    const model =
      body.byok.model ||
      DEFAULT_MODELS[body.byok.provider] ||
      MODEL_OPTIONS[body.byok.provider][0];
    const byokKey = body.byok.key;
    const providerName = body.byok.provider;
    const callProvider: ProviderCall = (overridePrompt) =>
      provider.generate({
        apiKey: byokKey,
        model,
        systemPrompt,
        userPrompt: overridePrompt,
        responseFormat: "json",
      });
    try {
      const result = await callProvider(userPrompt);
      const parsed = tryParseJson(result.text);
      let payload: Record<string, unknown> = parsed.ok
        ? parsed.data
        : { warning: "model returned non-JSON; raw text included", raw: result.text };

      // Post-LLM lint + optional one-shot retry.
      let postLint: LintResult | null = null;
      let usage = result.usage;
      if (parsed.ok) {
        const code = extractCode(payload, flow);
        postLint = code ? await lintContract(code, { stage: "post" }) : null;
        if (postLint) {
          const retried = await maybeRetry({
            flow, callProvider, userPrompt, payload, postLint,
            t0, ipHash, tier: "byok", provider: providerName, model,
          });
          payload = retried.payload;
          postLint = retried.postLint;
          if (retried.retryUsage) usage = retried.retryUsage;
        }
      }
      if (postLint) payload.lint = summarizeLint(postLint);

      log({
        event: "llm_success",
        ipHash,
        tier: "byok",
        flow,
        provider: providerName,
        model,
        ok: true,
        latencyMs: Date.now() - t0,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        attemptIndex,
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
        attemptIndex,
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
  const freeModel = process.env.SERVER_LLM_MODEL || SERVER_DEFAULT_MODEL;
  const callProvider: ProviderCall = (overridePrompt) =>
    provider.generate({
      apiKey: serverKey,
      model: freeModel,
      systemPrompt,
      userPrompt: overridePrompt,
      responseFormat: "json",
    });
  try {
    const result = await callProvider(userPrompt);
    const parsed = tryParseJson(result.text);
    let payload: Record<string, unknown> = parsed.ok
      ? parsed.data
      : { warning: "model returned non-JSON; raw text included", raw: result.text };

    // Post-LLM lint + optional one-shot retry. The retry shares the same
    // rate-limit reservation pulled above — no second checkAndReserve. A
    // retry failure also does NOT trip the circuit breaker (see maybeRetry).
    let postLint: LintResult | null = null;
    let usage = result.usage;
    if (parsed.ok) {
      const code = extractCode(payload, flow);
      postLint = code ? await lintContract(code, { stage: "post" }) : null;
      if (postLint) {
        const retried = await maybeRetry({
          flow, callProvider, userPrompt, payload, postLint,
          t0, ipHash, tier: "free", provider: "gemini", model: freeModel,
        });
        payload = retried.payload;
        postLint = retried.postLint;
        if (retried.retryUsage) usage = retried.retryUsage;
      }
    }
    if (postLint) payload.lint = summarizeLint(postLint);

    // Fire-and-forget USD top-up. Pricing wires in later; until then
    // this is a no-op (recordUsageCost ignores zero).
    void recordUsageCost(0);

    log({
      event: "llm_success",
      ipHash,
      tier: "free",
      flow,
      provider: "gemini",
      model: freeModel,
      ok: true,
      latencyMs: Date.now() - t0,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      attemptIndex,
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
      attemptIndex,
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
