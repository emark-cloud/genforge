"use client";

import { useSyncExternalStore } from "react";
import { getActiveByok, type ActiveByok } from "@/lib/keys";

/** Window event name dispatched by SettingsModal whenever keys/models/active change. */
export const BYOK_CHANGED_EVENT = "genforge:byok-changed";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(BYOK_CHANGED_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(BYOK_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

// useSyncExternalStore needs a stable reference across calls when the
// underlying values haven't changed — otherwise React infinite-loops. Cache
// the last snapshot keyed by the only fields that matter.
let cached: ActiveByok | null = null;
let cachedKey = "";

function snapshot(): ActiveByok | null {
  const next = getActiveByok();
  const key = next ? `${next.provider}|${next.key}|${next.model}` : "";
  if (key !== cachedKey) {
    cachedKey = key;
    cached = next;
  }
  return cached;
}

function serverSnapshot(): ActiveByok | null {
  return null;
}

/**
 * Subscribes to BYOK changes so the indicator + CTA buttons update the moment
 * the user adds or clears a key in the Settings modal. Also listens for
 * cross-tab `storage` events so two tabs stay in sync.
 *
 * Uses `useSyncExternalStore` because this is an external (localStorage) store —
 * the canonical React 19 pattern for this exact case.
 */
export function useByok(): ActiveByok | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

export function emitByokChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(BYOK_CHANGED_EVENT));
}
