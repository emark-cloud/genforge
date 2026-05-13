/**
 * Scan pipeline — diagnostic only, never rewrites code.
 *
 *   1. validate the request body (contract + optional byok)
 *   2. run the lint microservice. If it's unreachable, respond 503 — Scan
 *      is *the* diagnostic action, so silent fail-open (as in run-llm.ts)
 *      would mislead the user.
 *   3. if the contract is clean, skip the LLM entirely and respond with an
 *      empty summary — no point burning tokens to say "looks good".
 *   4. otherwise, ask the LLM for a single plain-English overall summary.
 *      Reserves a slot from `checkAndReserveScan` (separate per-IP counter
 *      so Scan doesn't burn the user's Fix quota), still subject to the
 *      same global request + USD ceilings and circuit breaker.
 *   5. if the LLM call fails for any reason, the user still gets the lint
 *      findings — a degraded but useful result, not an error.
 */

import { getProvider, LLMError, type ProviderName } from "./providers";
import {
  SERVER_DEFAULT_MODEL,
  DEFAULT_MODELS,
  MODEL_OPTIONS,
} from "./models";
import {
  checkAndReserveScan,
  peekScanRemaining,
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
} from "./validation";
import { SCAN_SYSTEM_PROMPT, buildScanUserPrompt } from "./scan-prompt";

export type ScanBody = {
  contract: string;
  byok?: Byok | null;
};

export type RunResult = {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

function validateScanBody(
  raw: unknown,
):
  | { ok: true; body: ScanBody }
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
  const byok = validateByok(o.byok);
  if (!byok.ok) return byok;
  return { ok: true, body: { contract: o.contract, byok: byok.byok } };
}

function quotaHeaders(
  tier: "free" | "byok",
  ipRemaining: number | null,
  ipLimit: number | null,
): Record<string, string> {
  const h: Record<string, string> = { "x-genforge-tier": tier };
  if (tier === "free" && ipRemaining != null && ipLimit != null) {
    h["x-scan-ratelimit-limit"] = String(ipLimit);
    h["x-scan-ratelimit-remaining"] = String(ipRemaining);
  }
  return h;
}

type Args = { raw: unknown; headers: Headers };

export async function runScan(args: Args): Promise<RunResult> {
  const t0 = Date.now();

  const validated = validateScanBody(args.raw);
  if (!validated.ok) {
    return {
      status: validated.status,
      body: { error: validated.reason },
      headers: { "x-genforge-tier": "n/a" },
    };
  }
  const body = validated.body;

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

  // 1. Lint. Unlike run-llm.ts (which folds lint into the prompt and is
  //    fail-open), Scan is *the* diagnostic — without lint there's nothing
  //    to scan. Surface a clear error instead of pretending it ran.
  const lint = await lintContract(body.contract, { stage: "pre" });
  if (!lint) {
    log({
      event: "scan",
      ipHash,
      tier: body.byok ? "byok" : "free",
      ok: false,
      latencyMs: Date.now() - t0,
      reason: "lint_unavailable",
    });
    return {
      status: 503,
      body: {
        error:
          "Scan unavailable. The diagnostic service is unreachable — try again in a moment, or use Fix instead.",
        reason: "lint_unavailable",
      },
      headers: { "x-genforge-tier": body.byok ? "byok" : "free" },
    };
  }

  // 2. Clean path — no findings means no work for the LLM.
  if (lint.errors.length === 0 && lint.warnings.length === 0) {
    log({
      event: "scan",
      ipHash,
      tier: body.byok ? "byok" : "free",
      ok: true,
      latencyMs: Date.now() - t0,
      errorCount: 0,
      warnCount: 0,
      reason: "clean",
    });
    // Free-tier remaining is unchanged on a clean scan (no slot pulled),
    // but we still report current state so the UI stays in sync.
    let headers = quotaHeaders(body.byok ? "byok" : "free", null, null);
    if (!body.byok) {
      try {
        const peek = await peekScanRemaining(ipHash);
        headers = quotaHeaders("free", peek.ipRemaining, peek.ipLimit);
      } catch {
        /* peek failure shouldn't poison the response */
      }
    }
    return {
      status: 200,
      body: { lint: summarizeLint(lint), summary: null },
      headers,
    };
  }

  // 3. Issues found — call the LLM for a plain-English summary.
  return body.byok
    ? await runByokSummary({ body, lint, ipHash, t0 })
    : await runFreeSummary({ body, lint, ipHash, t0 });
}

type SummaryArgs = {
  body: ScanBody;
  lint: LintResult;
  ipHash: string;
  t0: number;
};

function buildSummaryPrompt(body: ScanBody, lint: LintResult): string {
  return buildScanUserPrompt({
    contract: body.contract,
    lintBlock: formatLintForPrompt(lint),
  });
}

function extractSummary(payload: Record<string, unknown>): string | null {
  const v = payload.summary;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  // Cap to ~800 chars defensively; the prompt asks for ≤600.
  return trimmed.length > 800 ? trimmed.slice(0, 800) + "…" : trimmed;
}

function degradedResponse(
  lint: LintResult,
  tier: "free" | "byok",
  ipRemaining: number | null,
  ipLimit: number | null,
): RunResult {
  return {
    status: 200,
    body: {
      lint: summarizeLint(lint),
      summary: null,
      summaryError:
        "Couldn't generate an explanation right now — lint findings only.",
    },
    headers: quotaHeaders(tier, ipRemaining, ipLimit),
  };
}

async function runByokSummary(args: SummaryArgs): Promise<RunResult> {
  const { body, lint, ipHash, t0 } = args;
  const byok = body.byok!;
  const providerName: ProviderName = byok.provider;
  const provider = getProvider(providerName);
  const model =
    byok.model ||
    DEFAULT_MODELS[providerName] ||
    MODEL_OPTIONS[providerName][0];

  try {
    const result = await provider.generate({
      apiKey: byok.key,
      model,
      systemPrompt: SCAN_SYSTEM_PROMPT,
      userPrompt: buildSummaryPrompt(body, lint),
      responseFormat: "json",
    });
    const parsed = tryParseJson(result.text);
    const summary = parsed.ok ? extractSummary(parsed.data) : null;
    log({
      event: "scan",
      ipHash,
      tier: "byok",
      provider: providerName,
      model,
      ok: true,
      latencyMs: Date.now() - t0,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      errorCount: lint.errors.length,
      warnCount: lint.warnings.length,
      reason: summary ? "summary" : "lint_only",
    });
    return {
      status: 200,
      body: { lint: summarizeLint(lint), summary },
      headers: quotaHeaders("byok", null, null),
    };
  } catch (e) {
    const status = e instanceof LLMError ? (e.status ?? 502) : 502;
    log({
      event: "scan",
      ipHash,
      tier: "byok",
      provider: providerName,
      model,
      ok: false,
      status,
      latencyMs: Date.now() - t0,
      errorCount: lint.errors.length,
      warnCount: lint.warnings.length,
      reason: e instanceof LLMError ? `${e.provider}_${e.status ?? "error"}` : "byok_unexpected",
    });
    return degradedResponse(lint, "byok", null, null);
  }
}

async function runFreeSummary(args: SummaryArgs): Promise<RunResult> {
  const { body, lint, ipHash, t0 } = args;

  const serverKey = process.env.SERVER_LLM_KEY;
  if (!serverKey) {
    log({
      event: "scan",
      ipHash,
      tier: "free",
      ok: false,
      latencyMs: Date.now() - t0,
      reason: "server_key_missing",
    });
    return degradedResponse(lint, "free", null, null);
  }

  if (await isOpen()) {
    const until = await openUntil();
    log({
      event: "scan",
      ipHash,
      tier: "free",
      ok: false,
      status: 503,
      latencyMs: Date.now() - t0,
      reason: "breaker_open",
    });
    const peek = await peekScanRemaining(ipHash).catch(() => null);
    return {
      status: 200,
      body: {
        lint: summarizeLint(lint),
        summary: null,
        summaryError:
          "Free-tier explanations are paused while the provider recovers. Add your own key in Settings, or use the lint findings below.",
      },
      headers: {
        ...quotaHeaders("free", peek?.ipRemaining ?? null, peek?.ipLimit ?? null),
        ...(until
          ? { "retry-after": String(Math.max(1, Math.ceil((until - Date.now()) / 1000))) }
          : {}),
      },
    };
  }

  const reservation = await checkAndReserveScan(ipHash);
  if (!reservation.allow) {
    log({
      event: "scan",
      ipHash,
      tier: "free",
      ok: false,
      status: 429,
      latencyMs: Date.now() - t0,
      reason: reservation.reason,
    });
    const userMessage =
      reservation.reason === "per_ip"
        ? "You've used today's free scans. Add your own key in Settings to continue."
        : "The free tier hit today's global limit. Add your own key in Settings to continue.";
    return {
      status: 429,
      body: { error: userMessage, reason: reservation.reason, lint: summarizeLint(lint) },
      headers: quotaHeaders("free", reservation.ipRemaining, reservation.ipLimit),
    };
  }

  const providerName: ProviderName = "gemini";
  const provider = getProvider(providerName);
  const model = process.env.SERVER_LLM_MODEL || SERVER_DEFAULT_MODEL;

  try {
    const result = await provider.generate({
      apiKey: serverKey,
      model,
      systemPrompt: SCAN_SYSTEM_PROMPT,
      userPrompt: buildSummaryPrompt(body, lint),
      responseFormat: "json",
    });
    const parsed = tryParseJson(result.text);
    const summary = parsed.ok ? extractSummary(parsed.data) : null;
    log({
      event: "scan",
      ipHash,
      tier: "free",
      provider: providerName,
      model,
      ok: true,
      latencyMs: Date.now() - t0,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      errorCount: lint.errors.length,
      warnCount: lint.warnings.length,
      reason: summary ? "summary" : "lint_only",
    });
    return {
      status: 200,
      body: { lint: summarizeLint(lint), summary },
      headers: quotaHeaders("free", reservation.ipRemaining, reservation.ipLimit),
    };
  } catch (e) {
    const status = e instanceof LLMError ? (e.status ?? 502) : 502;
    if (status >= 500) {
      const tripped = await recordFailure();
      if (tripped) {
        log({ event: "circuit_open", tier: "free", ok: false, reason: "threshold_reached" });
      }
    }
    log({
      event: "scan",
      ipHash,
      tier: "free",
      provider: providerName,
      model,
      ok: false,
      status,
      latencyMs: Date.now() - t0,
      errorCount: lint.errors.length,
      warnCount: lint.warnings.length,
      reason: e instanceof LLMError ? `gemini_${e.status ?? "error"}` : "free_unexpected",
    });
    return degradedResponse(
      lint,
      "free",
      reservation.ipRemaining,
      reservation.ipLimit,
    );
  }
}
