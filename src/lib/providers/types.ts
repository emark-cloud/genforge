/**
 * Shared types for the LLM provider abstraction.
 *
 * Per SPEC §"Provider abstraction" — every provider implements one method.
 * The system + user prompts are provider-agnostic; per-provider quirks
 * (Anthropic's `system` field, OpenAI's `response_format`, Gemini's
 * `responseMimeType`) are absorbed inside each adapter.
 */

export type ProviderName = "anthropic" | "openai" | "gemini";

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

export type GenerateArgs = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  /** v1 only supports JSON output; the adapters bake provider-specific JSON-mode in. */
  responseFormat: "json";
};

export type GenerateResult = {
  /** Raw text returned by the provider. The caller is responsible for parsing JSON
   *  and applying fence-strip fallbacks per GUIDELINES.md §4.14. */
  text: string;
  usage?: TokenUsage;
};

export interface LLMProvider {
  readonly name: ProviderName;
  generate(args: GenerateArgs): Promise<GenerateResult>;
}

/**
 * Single error type all adapters throw. Carries the provider name + a status
 * code (HTTP-like; null when unknown) + a sanitized message. Callers can
 * surface `provider` and `status` to the user without leaking SDK internals.
 */
export class LLMError extends Error {
  constructor(
    public readonly provider: ProviderName,
    public readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

/** Strip anything that might be an API key from an error message. Belt-and-braces:
 *  we never log raw error objects, but if a stack trace echoes a key we redact it. */
const KEY_PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic-style
  /AIza[A-Za-z0-9_-]{16,}/g, // Google
];

function redactKeys(s: string): string {
  let out = s;
  for (const re of KEY_PATTERNS) out = out.replace(re, "[redacted]");
  return out;
}

/** Best-effort error normalizer used by every adapter. */
export function normalizeError(provider: ProviderName, e: unknown): LLMError {
  if (e instanceof LLMError) return e;
  const err = e as { status?: number; statusCode?: number; message?: string };
  const status = err.status ?? err.statusCode ?? null;
  const message = redactKeys(err.message ?? String(e) ?? "Unknown error");
  return new LLMError(provider, status, message);
}
