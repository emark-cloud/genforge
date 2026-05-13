"use client";

import { useState } from "react";
import { GitCompare, FileCode, RotateCcw } from "lucide-react";
import { Editor } from "./Editor";
import { DiffView } from "./DiffView";
import { Markdown } from "./Markdown";
import { CopyButton } from "./CopyButton";
import { DownloadButton } from "./DownloadButton";
import { LintPill } from "./LintPill";
import { RefixForm } from "./RefixForm";
import type { LintSummary } from "@/lib/lint";

export type DebugResult = {
  fixed_code: string;
  explanation: string;
  changes?: { what: string; why: string }[];
  lint?: LintSummary;
};

/** One iteration in the refix chain — see `RefixForm`/`DebugTab` for the
 * full state lifecycle. Mirrors `DebugAttempt` in `src/lib/system-prompt.ts`. */
export type DebugAttempt = {
  fixed_code: string;
  explanation: string;
  error: string;
};

type Props = {
  /** The string to diff against. First Fix: the user's paste. After each
   * Refix: the prior fix's `fixed_code` — so the diff highlights only what
   * changed in this iteration. */
  diffBase: string;
  /** The fix returned by the backend. */
  result: DebugResult;
  /** Refix chain (most recent last). When empty or single-element, the
   * "Attempt N" pill is hidden. */
  attempts: DebugAttempt[];
  /** Submit a new error to the LLM with the prior chain as context. Resolves
   * with `{ ok }`; the form keeps its state on `ok: false`. */
  onRefix: (newError: string) => Promise<{ ok: boolean; error?: string }>;
  /** True when refix should be blocked (e.g. free-tier exhausted). */
  refixDisabled?: boolean;
};

type View = "diff" | "full";

/**
 * Right-half output for the Debug flow. Defaults to Diff view per DESIGN.md
 * locked decision; user can flip to Full with the pill toggle above the code.
 *
 * The Refix loop lives entirely on this side — its memory chain resets only
 * when the user clicks Fix on the input side (see `DebugTab.runFix`).
 */
export function DebugOutput({
  diffBase,
  result,
  attempts,
  onRefix,
  refixDisabled,
}: Props) {
  const [view, setView] = useState<View>("diff");
  const [refixOpen, setRefixOpen] = useState(false);

  const handleRefix = async (newError: string) => {
    const res = await onRefix(newError);
    if (res.ok) setRefixOpen(false);
    return res;
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-[var(--space-4)] overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-[var(--space-3)]">
        <Toggle view={view} onChange={setView} />
        <div className="flex items-center gap-[var(--space-3)]">
          {attempts.length > 1 && <AttemptPill n={attempts.length} />}
          <LintPill lint={result.lint} />
          <div className="flex items-center gap-[var(--space-2)]">
            <RefixButton
              active={refixOpen}
              disabled={refixDisabled}
              onClick={() => setRefixOpen((v) => !v)}
            />
            <CopyButton text={result.fixed_code} label="Copy" />
            <DownloadButton filename="contract.py" content={result.fixed_code} />
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[var(--space-4)] overflow-y-auto pr-[var(--space-1)]">
        {refixOpen && (
          <RefixForm
            onSubmit={handleRefix}
            onCancel={() => setRefixOpen(false)}
            disabled={refixDisabled}
          />
        )}
        <div className="h-[clamp(320px,55vh,560px)] shrink-0">
          {view === "diff" ? (
            <DiffView original={diffBase} modified={result.fixed_code} />
          ) : (
            <Editor value={result.fixed_code} readOnly ariaLabel="Fixed contract" />
          )}
        </div>

        <div className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] border border-subtle bg-card p-[var(--space-5)]">
          <span className="label-caps">Explanation</span>
          <Markdown>{result.explanation || "_No explanation returned._"}</Markdown>
          {result.changes && result.changes.length > 0 && (
            <div className="flex flex-col gap-[var(--space-2)] mt-[var(--space-2)]">
              <span className="label-caps">Changes</span>
              <ul className="flex flex-col gap-[var(--space-2)]">
                {result.changes.map((c, i) => (
                  <li
                    key={i}
                    className="flex flex-col gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-subtle bg-elevated p-[var(--space-3)]"
                  >
                    <span className="text-base text-primary">{c.what}</span>
                    <span className="text-sm text-secondary">{c.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RefixButton({
  active,
  disabled,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label="Refix with a new error"
      title="Send a new error from Studio without losing this fix"
      className={`inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border px-[var(--space-3)] py-[var(--space-2)] text-sm transition-colors duration-[var(--duration-fast)] disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? "border-strong bg-elevated text-primary"
          : "border-default bg-card text-secondary hover:text-primary hover:bg-card-hover"
      }`}
    >
      <RotateCcw size={14} aria-hidden="true" />
      Refix
    </button>
  );
}

function AttemptPill({ n }: { n: number }) {
  return (
    <span
      aria-label={`Iteration ${n} of this debug session`}
      className="inline-flex items-center rounded-[var(--radius-pill)] border border-subtle bg-card px-[var(--space-3)] py-[2px] font-mono text-xs tabular-nums text-secondary"
    >
      Attempt {n}
    </span>
  );
}

function Toggle({
  view,
  onChange,
}: {
  view: View;
  onChange: (v: View) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Output view"
      className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-pill)] border border-subtle bg-card p-[3px]"
    >
      {(
        [
          { id: "diff" as const, label: "Diff", Icon: GitCompare },
          { id: "full" as const, label: "Full", Icon: FileCode },
        ]
      ).map(({ id, label, Icon }) => {
        const isActive = view === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(id)}
            className={`inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-pill)] px-[var(--space-3)] py-[var(--space-1)] text-sm font-medium transition-colors duration-[var(--duration-fast)] ${
              isActive
                ? "bg-elevated text-primary"
                : "text-secondary hover:text-primary"
            }`}
          >
            <Icon size={12} aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
