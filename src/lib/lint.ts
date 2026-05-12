/**
 * Client for the lint microservice (see lint-service/README.md).
 *
 * Fail-open: every failure mode (no URL configured, non-2xx, timeout,
 * parse error) returns `null` so the calling route returns the LLM output
 * regardless. Lint is additive, never gating.
 *
 * Log hygiene: this module never logs contract source, the secret, or the
 * raw lint output — only counts + status + duration.
 */

import { log } from "./log";

export type LintIssue = {
  line: number;
  col?: number;
  code?: string;
  message: string;
};

export type LintResult = {
  ok: boolean;
  errors: LintIssue[];
  warnings: LintIssue[];
  durationMs: number;
};

/** The compact summary attached to `/api/debug` and `/api/generate` responses. */
export type LintSummary = {
  ok: boolean;
  errorCount: number;
  warnCount: number;
  issues: LintIssue[];
};

type LintOpts = {
  timeoutMs?: number;
  /** Which leg of the pipeline this lint is for — affects log `stage`. */
  stage?: "pre" | "post";
};

const DEFAULT_TIMEOUT_MS = Number(process.env.LINT_TIMEOUT_MS ?? "5000");

/** Largest body we'll send to the lint service. Mirrors the server-side cap. */
const MAX_BODY_BYTES = 64 * 1024;

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

function isValidUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    // Require https in production. Allow http on localhost for dev.
    if (process.env.NODE_ENV === "production") return parsed.protocol === "https:";
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Lint a contract via the configured microservice.
 *
 * Returns `null` on every failure mode — callers MUST treat null as
 * "lint unavailable, proceed with LLM result as if lint wasn't asked."
 */
export async function lintContract(source: string, opts: LintOpts = {}): Promise<LintResult | null> {
  const url = process.env.LINT_SERVICE_URL;
  const secret = process.env.LINT_SERVICE_SECRET;
  const stage = opts.stage ?? "post";

  if (!url || !secret) return null;
  if (!isValidUrl(url)) {
    log({ event: "lint", ok: false, stage, reason: "invalid_url" });
    return null;
  }
  if (typeof source !== "string" || source.trim().length === 0) return null;
  if (byteLen(source) > MAX_BODY_BYTES) {
    log({ event: "lint", ok: false, stage, reason: "source_too_large" });
    return null;
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);

  try {
    const res = await fetch(new URL("/lint", url).toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lint-secret": secret,
      },
      body: JSON.stringify({ contract: source }),
      signal: ctl.signal,
    });
    if (!res.ok) {
      log({ event: "lint", ok: false, stage, status: res.status, latencyMs: Date.now() - t0, reason: `service_${res.status}` });
      return null;
    }
    const raw: unknown = await res.json().catch(() => null);
    if (!raw || typeof raw !== "object") {
      log({ event: "lint", ok: false, stage, latencyMs: Date.now() - t0, reason: "parse_error" });
      return null;
    }
    const data = raw as Record<string, unknown>;
    const errors = Array.isArray(data.errors) ? (data.errors as LintIssue[]) : [];
    const warnings = Array.isArray(data.warnings) ? (data.warnings as LintIssue[]) : [];
    const result: LintResult = {
      ok: Boolean(data.ok) && errors.length === 0,
      errors,
      warnings,
      durationMs: Date.now() - t0,
    };
    log({
      event: "lint",
      ok: result.ok,
      stage,
      latencyMs: result.durationMs,
      errorCount: errors.length,
      warnCount: warnings.length,
    });
    return result;
  } catch (e) {
    const aborted = (e as { name?: string } | undefined)?.name === "AbortError";
    log({
      event: "lint",
      ok: false,
      stage,
      latencyMs: Date.now() - t0,
      reason: aborted ? "timeout" : "fetch_error",
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Compact summary suitable for the response body. Caps issues at 20. */
export function summarize(r: LintResult): LintSummary {
  const ISSUE_CAP = 20;
  // Surface errors first, then warnings, up to the cap.
  const issues = [...r.errors, ...r.warnings].slice(0, ISSUE_CAP);
  return {
    ok: r.ok,
    errorCount: r.errors.length,
    warnCount: r.warnings.length,
    issues,
  };
}

/** Markdown block injected into the LLM user prompt as additional context. ≤2 KiB. */
export function formatLintForPrompt(r: LintResult): string {
  if (r.errors.length === 0 && r.warnings.length === 0) return "";
  const lines: string[] = ["## Lint findings"];
  const fmt = (i: LintIssue, kind: "ERROR" | "WARNING") => {
    const loc = i.line > 0 ? `line ${i.line}${i.col != null ? `:${i.col}` : ""}` : "—";
    const code = i.code ? ` [${i.code}]` : "";
    return `- ${kind}${code} ${loc}: ${i.message}`;
  };
  for (const e of r.errors.slice(0, 10)) lines.push(fmt(e, "ERROR"));
  for (const w of r.warnings.slice(0, 10)) lines.push(fmt(w, "WARNING"));
  const out = lines.join("\n");
  return out.length > 2048 ? out.slice(0, 2048) + "\n…(truncated)" : out;
}
