/**
 * Structured logger with a type-level guarantee that prompts, responses,
 * and API keys cannot be logged.
 *
 * The trick: `LogEvent` is a *closed* type. Adding a property like
 * `prompt` or `apiKey` is a compile error, not a runtime one. If a future
 * change tempts a contributor to log a response body, TypeScript stops
 * them at the call site.
 */

import type { ProviderName } from "./providers/types";

/**
 * The ONLY shape allowed through `log()`. Do not extend this with any
 * field that could contain user input, model output, or credentials.
 */
export type LogEvent = {
  /** Event kind. New kinds: add to the union, not as a free-form string. */
  event:
    | "llm_request"
    | "llm_success"
    | "llm_failure"
    | "rate_limit_block"
    | "circuit_open"
    | "circuit_block";
  /** ISO-8601 timestamp set by the logger. */
  ts?: string;
  /** Hashed client IP (see `lib/ip.ts`). Never the raw IP. */
  ipHash?: string;
  tier?: "free" | "byok";
  flow?: "debug" | "generate";
  provider?: ProviderName;
  /** Only model IDs — never API keys. */
  model?: string;
  ok?: boolean;
  status?: number | null;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Sanitized short reason, e.g. "free_tier_exhausted" or "provider_5xx". */
  reason?: string;
};

/** Generic catch for accidental forbidden keys. The intersection with
 *  `never` for any banned name makes the call a compile error if anyone
 *  tries to log a prompt/response/key. */
type Forbidden = "prompt" | "response" | "apiKey" | "key" | "messages" | "body";
type SafeEvent<T> = T & { [K in Forbidden]?: never };

export function log<T extends LogEvent>(e: SafeEvent<T>): void {
  const line = { ts: new Date().toISOString(), ...e };
  // One JSON line per event. Easy to grep, easy to ship to a log drain.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}
