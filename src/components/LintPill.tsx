"use client";

import { useState } from "react";
import { CheckCircle2, AlertTriangle, OctagonAlert } from "lucide-react";
import type { LintSummary } from "@/lib/lint";

type Props = {
  /** When undefined, the pill renders nothing — lint service was unset or unreachable. */
  lint?: LintSummary | null;
};

/**
 * Three-state status pill for the lint result. Uses semantic --ok / --warn /
 * --error tokens — never --accent (violet is reserved for one thing per
 * surface, per DESIGN.md).
 *
 * When errors > 0 the pill renders inside a <details> that auto-expands so
 * the user sees the offending lines without an extra click.
 */
export function LintPill({ lint }: Props) {
  // Auto-open on first render if there are errors so the user sees them
  // without an extra click. After that, the toggle is user-controlled.
  const initialOpen = (lint?.errorCount ?? 0) > 0 && (lint?.issues.length ?? 0) > 0;
  const [open, setOpen] = useState(initialOpen);
  if (!lint) return null;

  const state: "ok" | "warn" | "error" =
    lint.errorCount > 0 ? "error" : lint.warnCount > 0 ? "warn" : "ok";

  const Icon =
    state === "ok" ? CheckCircle2 : state === "warn" ? AlertTriangle : OctagonAlert;

  const label =
    state === "ok"
      ? "Lint clean"
      : state === "error"
        ? `${lint.errorCount} lint error${lint.errorCount === 1 ? "" : "s"}`
        : `${lint.warnCount} lint warning${lint.warnCount === 1 ? "" : "s"}`;

  const colorVar =
    state === "ok" ? "var(--ok)" : state === "warn" ? "var(--warn)" : "var(--error)";

  const expandable = lint.issues.length > 0;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={expandable ? open : undefined}
        aria-label={
          expandable ? `${label} — toggle details` : label
        }
        disabled={!expandable}
        className="inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-pill)] border px-[var(--space-3)] py-[2px] text-xs font-medium transition-colors duration-[var(--duration-fast)] disabled:cursor-default"
        style={{
          color: colorVar,
          borderColor: colorVar,
          background: `color-mix(in srgb, ${colorVar} 10%, transparent)`,
        }}
      >
        <Icon size={12} aria-hidden="true" />
        {label}
      </button>
      {expandable && open && (
        <div
          role="region"
          aria-label="Lint findings"
          className="absolute right-0 top-[calc(100%+var(--space-2))] z-10 w-[420px] max-w-[80vw] rounded-[var(--radius-md)] border border-default bg-elevated p-[var(--space-3)] shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
        >
          <ul className="flex flex-col gap-[var(--space-2)]">
            {lint.issues.slice(0, 12).map((i, idx) => {
              const isErr = idx < lint.errorCount;
              const loc =
                i.line > 0
                  ? `line ${i.line}${i.col != null ? `:${i.col}` : ""}`
                  : "—";
              return (
                <li
                  key={`${i.code ?? "x"}-${idx}-${i.line}`}
                  className="flex flex-col gap-[2px] rounded-[var(--radius-sm)] border border-subtle bg-card p-[var(--space-2)]"
                >
                  <span className="flex items-center gap-[var(--space-2)] text-xs font-mono text-tertiary">
                    <span
                      style={{
                        color: isErr ? "var(--error)" : "var(--warn)",
                      }}
                    >
                      {isErr ? "ERROR" : "WARN"}
                    </span>
                    {i.code && <span>{i.code}</span>}
                    <span>{loc}</span>
                  </span>
                  <span className="text-sm text-primary">{i.message}</span>
                </li>
              );
            })}
            {lint.issues.length > 12 && (
              <li className="text-xs text-tertiary">
                …{lint.issues.length - 12} more not shown
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
