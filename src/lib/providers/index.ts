/**
 * Factory + barrel for the provider abstraction.
 *
 * Callers (the `/api/*` routes) get a provider via `getProvider("gemini")`
 * and never depend on a vendor SDK directly. Adding a fourth provider is
 * a matter of writing one file and wiring it into REGISTRY.
 */

import { anthropicProvider } from "./anthropic";
import { geminiProvider } from "./gemini";
import { openaiProvider } from "./openai";
import { type LLMProvider, type ProviderName } from "./types";

const REGISTRY: Record<ProviderName, LLMProvider> = {
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  openai: openaiProvider,
};

export function getProvider(name: ProviderName): LLMProvider {
  const p = REGISTRY[name];
  if (!p) throw new Error(`Unknown provider: ${name}`);
  return p;
}

export const PROVIDER_NAMES: readonly ProviderName[] = [
  "anthropic",
  "openai",
  "gemini",
] as const;

export {
  type LLMProvider,
  type ProviderName,
  type GenerateArgs,
  type GenerateResult,
  type TokenUsage,
  LLMError,
} from "./types";
