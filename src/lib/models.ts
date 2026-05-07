/**
 * Per-provider default model + the curated dropdown options shown in the
 * BYOK Settings modal. Keep this list short and current; users who want a
 * different model can paste their own model ID once we wire that in.
 *
 * Defaults are chosen for "highest quality the user is willing to pay for"
 * — the BYOK user is paying their own provider, so we lean flagship.
 */

import type { ProviderName } from "./providers/types";

export const SERVER_DEFAULT_MODEL = "gemini-2.5-flash";

export const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: "claude-opus-4-7",
  openai: "gpt-5",
  gemini: "gemini-2.5-pro",
};

export const MODEL_OPTIONS: Record<ProviderName, readonly string[]> = {
  anthropic: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"],
  openai: ["gpt-5", "gpt-5-mini"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
};
