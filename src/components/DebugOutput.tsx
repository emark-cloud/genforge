"use client";

import { useState } from "react";
import { GitCompare, FileCode } from "lucide-react";
import { Editor } from "./Editor";
import { DiffView } from "./DiffView";
import { Markdown } from "./Markdown";
import { CopyButton } from "./CopyButton";
import { DownloadButton } from "./DownloadButton";
import { LintPill } from "./LintPill";
import type { LintSummary } from "@/lib/lint";

export type DebugResult = {
  fixed_code: string;
  explanation: string;
  changes?: { what: string; why: string }[];
  lint?: LintSummary;
};

type Props = {
  /** The contract the user pasted in. Needed to diff against. */
  original: string;
  /** The fix returned by the backend. */
  result: DebugResult;
};

type View = "diff" | "full";

/**
 * Right-half output for the Debug flow. Defaults to Diff view per DESIGN.md
 * locked decision; user can flip to Full with the pill toggle above the code.
 */
export function DebugOutput({ original, result }: Props) {
  const [view, setView] = useState<View>("diff");

  return (
    <div className="flex h-full min-h-0 flex-col gap-[var(--space-4)] overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-[var(--space-3)]">
        <Toggle view={view} onChange={setView} />
        <div className="flex items-center gap-[var(--space-3)]">
          <LintPill lint={result.lint} />
          <div className="flex items-center gap-[var(--space-2)]">
            <CopyButton text={result.fixed_code} label="Copy" />
            <DownloadButton filename="contract.py" content={result.fixed_code} />
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[var(--space-4)] overflow-y-auto pr-[var(--space-1)]">
        <div className="h-[clamp(320px,55vh,560px)] shrink-0">
          {view === "diff" ? (
            <DiffView original={original} modified={result.fixed_code} />
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
