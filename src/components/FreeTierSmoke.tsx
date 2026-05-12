"use client";

import { useCallback, useState } from "react";
import { FreeTierIndicator, isExhausted } from "./FreeTierIndicator";
import { SettingsLauncher } from "./SettingsLauncher";
import { useByok } from "@/hooks/useByok";
import { readQuotaHeaders, type Quota } from "@/lib/quota";

/**
 * Temporary harness for Step 8 verification. Sends a no-op POST to /api/debug
 * (with an obviously-invalid body so we never burn the model — we only care
 * about the rate-limit headers, which are emitted *before* validation runs)
 * and renders the FreeTierIndicator state alongside the gear button.
 *
 * Real wiring into the Debug/Generate CTAs lands in Steps 9/10.
 */
export function FreeTierSmoke() {
  const byok = useByok();
  const [quota, setQuota] = useState<Quota | null>(null);
  const [busy, setBusy] = useState(false);
  const exhausted = isExhausted(byok, quota);

  const ping = useCallback(async () => {
    setBusy(true);
    try {
      // We deliberately send a tiny valid payload so the call counts against
      // the quota (the rate-limit headers are only set when we actually pass
      // through the limiter, which happens before the LLM call).
      const res = await fetch("/api/debug", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contract: "x" }),
      });
      const q = readQuotaHeaders(res.headers);
      if (q) setQuota(q);
      // We don't care about the body for this harness.
      await res.text().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="flex flex-col gap-[var(--space-4)] w-full">
      <div className="flex items-center gap-[var(--space-4)]">
        <FreeTierIndicator byok={byok} quota={quota} />
        <SettingsLauncher pulse={exhausted} />
      </div>
      <div>
        <button
          type="button"
          onClick={ping}
          disabled={busy || exhausted}
          className="h-10 px-5 rounded-pill bg-accent text-on-accent text-base font-medium transition-colors duration-[120ms] hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40 disabled:hover:bg-accent disabled:cursor-not-allowed"
        >
          {busy ? "Calling…" : exhausted ? "Free tier exhausted" : "Fire test call"}
        </button>
      </div>
    </div>
  );
}
