"use client";

import { useCallback, useState } from "react";
import { AlertCircle, Send, X } from "lucide-react";
import { Spinner } from "./Spinner";

type Props = {
  /** Resolves with `{ ok }`; on `{ ok: false, error }` the form keeps its text
   * so the user can retry without re-typing. */
  onSubmit: (newError: string) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
  /** Optional disabled flag — e.g. when free-tier quota is exhausted. */
  disabled?: boolean;
};

/**
 * Output-side refix loop. User pastes a new error from GenLayer Studio and
 * sends it back; the parent threads `priorAttempts` into `/api/debug` so the
 * LLM iterates rather than starts over.
 *
 * Visual treatment matches the input-side textarea (`DebugTab.tsx:130-136`);
 * the Send button intentionally uses the neutral elevated surface — violet
 * (`bg-accent`) is reserved for the primary Fix CTA per CLAUDE.md hard rule 3.
 */
export function RefixForm({ onSubmit, onCancel, disabled }: Props) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = !busy && !disabled && value.trim().length > 0;

  const send = useCallback(async () => {
    if (!canSend) return;
    setBusy(true);
    setError(null);
    const res = await onSubmit(value);
    setBusy(false);
    if (res.ok) {
      setValue("");
    } else {
      setError(res.error ?? "Refix failed");
    }
  }, [canSend, onSubmit, value]);

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      send();
    }
  };

  return (
    <div
      className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] border border-subtle bg-card p-[var(--space-4)]"
      onKeyDown={onKey}
    >
      <div className="flex items-center justify-between">
        <span className="label-caps">New error from this run</span>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel refix"
          className="inline-flex items-center justify-center rounded-[var(--radius-sm)] p-[var(--space-1)] text-tertiary transition-colors duration-[var(--duration-fast)] hover:text-primary"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Paste the new GenVM error or describe what failed in Studio…"
        autoFocus
        className="min-h-[96px] resize-y rounded-[var(--radius-md)] border border-default bg-elevated px-[var(--space-4)] py-[var(--space-3)] text-base text-primary placeholder:text-tertiary transition-colors duration-[var(--duration-fast)] hover:border-strong"
      />
      <div className="flex items-center gap-[var(--space-3)]">
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          className="inline-flex items-center justify-center gap-[var(--space-2)] h-9 min-w-[112px] rounded-[var(--radius-pill)] border border-default bg-elevated px-[var(--space-4)] text-sm font-medium text-primary transition-colors duration-[var(--duration-fast)] hover:bg-card-hover disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-elevated"
        >
          {busy ? (
            <Spinner className="text-primary" />
          ) : (
            <>
              <Send size={13} aria-hidden="true" />
              Refix
            </>
          )}
        </button>
        <span className="text-xs text-tertiary">
          <span className="font-mono">⌘</span>+
          <span className="font-mono">Enter</span> to send
        </span>
      </div>
      {error && (
        <div
          role="alert"
          className="flex items-start gap-[var(--space-2)] rounded-[var(--radius-md)] border border-subtle bg-elevated px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--error)]"
        >
          <AlertCircle size={14} className="mt-[2px] shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
