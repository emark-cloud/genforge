"use client";

import { useCallback, useState } from "react";
import { Sparkles, AlertCircle } from "lucide-react";
import { Spinner } from "./Spinner";
import { EmptyOutput } from "./EmptyOutput";
import { GenerateOutput, type GenerateResult } from "./GenerateOutput";
import { isExhausted } from "./FreeTierIndicator";
import { readQuotaHeaders, type Quota } from "@/lib/quota";
import type { ActiveByok } from "@/lib/keys";

const PLACEHOLDER =
  "A sealed-bid auction. Bidders submit hashed bids during a bid phase, then reveal them. The LLM reads each revealed bid and declares the winner once the deadline passes…";

type Props = {
  byok: ActiveByok | null;
  quota: Quota | null;
  onQuotaUpdate: (q: Quota) => void;
};

export function GenerateTab({ byok, quota, onQuotaUpdate }: Props) {
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exhausted = isExhausted(byok, quota);
  const canRun = !busy && !exhausted && description.trim().length > 0;

  const runGenerate = useCallback(async () => {
    if (!canRun) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { description };
      if (byok) body.byok = { provider: byok.provider, key: byok.key, model: byok.model };
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const q = readQuotaHeaders(res.headers);
      if (q) onQuotaUpdate(q);
      const text = await res.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* leave null */
      }
      if (!res.ok) {
        const msg =
          (json && typeof json === "object" && "error" in json && typeof (json as { error: unknown }).error === "string"
            ? (json as { error: string }).error
            : null) ?? `Request failed (${res.status})`;
        setError(msg);
        return;
      }
      if (
        !json ||
        typeof json !== "object" ||
        !("code" in json) ||
        typeof (json as { code: unknown }).code !== "string"
      ) {
        const warning =
          json &&
          typeof json === "object" &&
          "warning" in json &&
          typeof (json as { warning: unknown }).warning === "string"
            ? (json as { warning: string }).warning
            : "Model returned unexpected JSON. Try again or refine your description.";
        setError(warning);
        return;
      }
      setResult(json as GenerateResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }, [canRun, byok, description, onQuotaUpdate]);

  const onInputKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      runGenerate();
    }
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-2 gap-[var(--space-5)] p-[var(--space-5)]">
      {/* Input side */}
      <div
        className="flex min-h-0 flex-col gap-[var(--space-4)]"
        onKeyDown={onInputKey}
      >
        <div className="flex items-center justify-between">
          <span className="label-caps">Describe your contract</span>
          <span className="text-xs text-tertiary font-mono">
            {description.length.toLocaleString()} chars
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={PLACEHOLDER}
            className="h-full w-full resize-none rounded-[var(--radius-md)] border border-default bg-card px-[var(--space-4)] py-[var(--space-3)] text-base text-primary placeholder:text-tertiary transition-colors duration-[var(--duration-fast)] hover:border-strong"
            aria-label="Contract description"
          />
        </div>
        <div className="flex items-center gap-[var(--space-3)]">
          <button
            type="button"
            onClick={runGenerate}
            disabled={!canRun}
            className="inline-flex items-center justify-center gap-[var(--space-2)] h-10 min-w-[140px] rounded-[var(--radius-pill)] bg-accent px-[var(--space-5)] text-base font-medium text-on-accent transition-colors duration-[var(--duration-fast)] hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40 disabled:hover:bg-accent disabled:cursor-not-allowed"
          >
            {busy ? (
              <Spinner className="text-on-accent" />
            ) : (
              <>
                <Sparkles size={14} aria-hidden="true" />
                Generate
              </>
            )}
          </button>
          <span className="text-xs text-tertiary">
            <span className="font-mono">⌘</span>+
            <span className="font-mono">Enter</span> to fire
          </span>
        </div>
        {error && (
          <div
            role="alert"
            className="flex items-start gap-[var(--space-2)] rounded-[var(--radius-md)] border border-subtle bg-card px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--error)]"
          >
            <AlertCircle size={14} className="mt-[2px] shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Output side */}
      <div className="min-h-0">
        {result ? (
          <GenerateOutput result={result} />
        ) : (
          <EmptyOutput hint="Describe what you want on the left and hit Generate." />
        )}
      </div>
    </div>
  );
}
