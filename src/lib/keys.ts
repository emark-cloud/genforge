/**
 * SSR-safe BYOK key + model storage.
 *
 * Keys live in `localStorage` only — they're sent to our backend on a single
 * request and never persisted server-side. The "current provider" pointer
 * tracks which of the (up to three) saved keys is active for the next call.
 *
 * Storage layout:
 *   genforge:byok:<provider>      → the raw API key string
 *   genforge:model:<provider>     → user-selected model id for that provider
 *   genforge:byok:current         → "anthropic" | "openai" | "gemini" — the
 *                                   currently active BYOK provider (or absent)
 */

import type { ProviderName } from "./providers/types";
import { DEFAULT_MODELS, MODEL_OPTIONS } from "./models";

const KEY_PREFIX = "genforge:byok:";
const MODEL_PREFIX = "genforge:model:";
const CURRENT_KEY = "genforge:byok:current";

const PROVIDERS: readonly ProviderName[] = ["anthropic", "openai", "gemini"];

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getKey(provider: ProviderName): string {
  return storage()?.getItem(KEY_PREFIX + provider) ?? "";
}

export function setKey(provider: ProviderName, key: string): void {
  const s = storage();
  if (!s) return;
  const trimmed = key.trim();
  if (!trimmed) {
    clearKey(provider);
    return;
  }
  s.setItem(KEY_PREFIX + provider, trimmed);
  if (!getCurrentProvider()) setCurrentProvider(provider);
}

export function clearKey(provider: ProviderName): void {
  const s = storage();
  if (!s) return;
  s.removeItem(KEY_PREFIX + provider);
  if (s.getItem(CURRENT_KEY) === provider) s.removeItem(CURRENT_KEY);
}

export function clearAll(): void {
  const s = storage();
  if (!s) return;
  for (const p of PROVIDERS) {
    s.removeItem(KEY_PREFIX + p);
    s.removeItem(MODEL_PREFIX + p);
  }
  s.removeItem(CURRENT_KEY);
}

export function getModel(provider: ProviderName): string {
  const stored = storage()?.getItem(MODEL_PREFIX + provider);
  if (stored && MODEL_OPTIONS[provider].includes(stored)) return stored;
  return DEFAULT_MODELS[provider];
}

export function setModel(provider: ProviderName, model: string): void {
  const s = storage();
  if (!s) return;
  if (!MODEL_OPTIONS[provider].includes(model)) return;
  s.setItem(MODEL_PREFIX + provider, model);
}

export function getCurrentProvider(): ProviderName | null {
  const s = storage();
  if (!s) return null;
  const raw = s.getItem(CURRENT_KEY);
  if (raw !== "anthropic" && raw !== "openai" && raw !== "gemini") return null;
  if (!s.getItem(KEY_PREFIX + raw)) return null;
  return raw;
}

export function setCurrentProvider(provider: ProviderName): void {
  const s = storage();
  if (!s) return;
  if (!s.getItem(KEY_PREFIX + provider)) return;
  s.setItem(CURRENT_KEY, provider);
}

export type ActiveByok = {
  provider: ProviderName;
  key: string;
  model: string;
};

/** What the page sends on a BYOK request. `null` means "use free tier." */
export function getActiveByok(): ActiveByok | null {
  const provider = getCurrentProvider();
  if (!provider) return null;
  const key = getKey(provider);
  if (!key) return null;
  return { provider, key, model: getModel(provider) };
}

export const ALL_PROVIDERS = PROVIDERS;
