"use client";

import { useCallback, useState } from "react";
import { Wrench, AlertCircle } from "lucide-react";
import { Editor } from "./Editor";
import { Spinner } from "./Spinner";
import { EmptyOutput } from "./EmptyOutput";
import { DebugOutput, type DebugResult } from "./DebugOutput";
import { isExhausted } from "./FreeTierIndicator";
import { readQuotaHeaders, type Quota } from "@/lib/quota";
import type { ActiveByok } from "@/lib/keys";

const STARTER_CONTRACT = `# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import gl

class MyContract(gl.Contract):
    pass
`;

type Props = {
  byok: ActiveByok | null;
  quota: Quota | null;
  onQuotaUpdate: (q: Quota) => void;
};

export function DebugTab({ byok, quota, onQuotaUpdate }: Props) {
  const [contract, setContract] = useState(STARTER_CONTRACT);
  const [errorContext, setErrorContext] = useState("");
  const [result, setResult] = useState<DebugResult | null>(null);
  // The contract value at the moment of the call — so the diff doesn't shift
  // if the user edits the input after firing.
  const [submitted, setSubmitted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exhausted = isExhausted(byok, quota);
  const canFix = !busy && !exhausted && contract.trim().length > 0;

  const runFix = useCallback(async () => {
    if (!canFix) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { contract };
      if (errorContext.trim()) body.errorContext = errorContext;
      if (byok) body.byok = { provider: byok.provider, key: byok.key, model: byok.model };
      const res = await fetch("/api/debug", {
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
        !("fixed_code" in json) ||
        typeof (json as { fixed_code: unknown }).fixed_code !== "string"
      ) {
        const warning =
          json &&
          typeof json === "object" &&
          "warning" in json &&
          typeof (json as { warning: unknown }).warning === "string"
            ? (json as { warning: string }).warning
            : "Model returned unexpected JSON. Try again or refine your error context.";
        setError(warning);
        return;
      }
      setSubmitted(contract);
      setResult(json as DebugResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }, [canFix, byok, contract, errorContext, onQuotaUpdate]);

  // ⌘+Enter / Ctrl+Enter to fire while focus is inside the input column.
  const onInputKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      runFix();
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
          <span className="label-caps">Your contract</span>
          <span className="text-xs text-tertiary font-mono">
            {contract.length.toLocaleString()} chars
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <Editor
            value={contract}
            onChange={setContract}
            ariaLabel="Contract source"
          />
        </div>
        <div className="flex flex-col gap-[var(--space-2)]">
          <label htmlFor="error-context" className="label-caps">
            What went wrong{" "}
            <span className="font-normal normal-case text-tertiary tracking-normal">
              (optional)
            </span>
          </label>
          <textarea
            id="error-context"
            value={errorContext}
            onChange={(e) => setErrorContext(e.target.value)}
            placeholder="Paste the GenVM error, traceback, or describe the failure…"
            className="min-h-[96px] resize-y rounded-[var(--radius-md)] border border-default bg-card px-[var(--space-4)] py-[var(--space-3)] text-base text-primary placeholder:text-tertiary transition-colors duration-[var(--duration-fast)] hover:border-strong"
          />
        </div>
        <div className="flex items-center gap-[var(--space-3)]">
          <button
            type="button"
            onClick={runFix}
            disabled={!canFix}
            className="inline-flex items-center justify-center gap-[var(--space-2)] h-10 min-w-[120px] rounded-[var(--radius-pill)] bg-accent px-[var(--space-5)] text-base font-medium text-on-accent transition-colors duration-[var(--duration-fast)] hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40 disabled:hover:bg-accent disabled:cursor-not-allowed"
          >
            {busy ? (
              <Spinner className="text-on-accent" />
            ) : (
              <>
                <Wrench size={14} aria-hidden="true" />
                Fix
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
          <DebugOutput original={submitted} result={result} />
        ) : (
          <EmptyOutput hint="Paste a contract on the left and hit Fix." />
        )}
      </div>
    </div>
  );
}
