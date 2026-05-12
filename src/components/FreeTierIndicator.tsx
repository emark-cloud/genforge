"use client";

import { Sparkles, KeyRound, AlertCircle } from "lucide-react";
import type { ActiveByok } from "@/lib/keys";
import type { Quota } from "@/lib/quota";

type Props = {
  /** Result of `useByok()` — null in free tier. */
  byok: ActiveByok | null;
  /** Most-recent free-tier quota read from response headers; null before the first call. */
  quota: Quota | null;
};

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
};

/**
 * Three mutually-exclusive states (DESIGN.md → free-tier indicator):
 *
 *   1. BYOK active     → "Using your <Provider> key" (key icon), no counter.
 *   2. Free, exhausted → "Free tier used up — add your own key in Settings" + violet alert dot.
 *   3. Free, available → "{remaining} / {limit} free today" (sparkle icon).
 *                        Before the first call this round-trips no headers, so we show
 *                        the quieter idle copy "Free tier" until we know the cap.
 */
export function FreeTierIndicator({ byok, quota }: Props) {
  if (byok) {
    return (
      <div
        className="inline-flex items-center gap-[var(--space-2)] text-sm text-secondary"
        aria-live="polite"
      >
        <KeyRound size={14} className="text-[var(--accent)]" aria-hidden="true" />
        <span>Using your {PROVIDER_LABEL[byok.provider] ?? byok.provider} key</span>
      </div>
    );
  }

  if (quota && quota.remaining <= 0) {
    return (
      <div
        className="inline-flex items-center gap-[var(--space-2)] text-sm text-secondary"
        aria-live="polite"
      >
        <AlertCircle
          size={14}
          className="text-[var(--accent)]"
          aria-hidden="true"
        />
        <span>
          Free tier used up — add your own key in{" "}
          <span className="text-primary">Settings</span>
        </span>
      </div>
    );
  }

  return (
    <div
      className="inline-flex items-center gap-[var(--space-2)] text-sm text-secondary"
      aria-live="polite"
    >
      <Sparkles size={14} className="text-tertiary" aria-hidden="true" />
      {quota ? (
        <span>
          <span className="text-primary tabular-nums">{quota.remaining}</span>
          <span className="text-tertiary"> / </span>
          <span className="tabular-nums">{quota.limit}</span> free today
        </span>
      ) : (
        <span>Free tier</span>
      )}
    </div>
  );
}

/** Convenience predicate — host pages use this to disable the CTA when exhausted. */
export function isExhausted(byok: ActiveByok | null, quota: Quota | null): boolean {
  if (byok) return false;
  return !!quota && quota.remaining <= 0;
}
