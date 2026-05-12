"use client";

import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";

type Props = {
  original: string;
  modified: string;
};

/**
 * Themed wrapper around react-diff-viewer-continued. Side-by-side, dark, with
 * the diff tints from DESIGN §"Diff view" (added = subtle green, removed = subtle red,
 * intra-line modifications get the stronger version of the same tint).
 *
 * All colors come from CSS tokens declared in globals.css — no hex literals here.
 */
export function DiffView({ original, modified }: Props) {
  return (
    <div className="diff-shell h-full w-full overflow-auto rounded-[var(--radius-md)] border border-subtle bg-card font-mono text-sm">
      <ReactDiffViewer
        oldValue={original}
        newValue={modified}
        splitView
        useDarkTheme
        hideLineNumbers={false}
        compareMethod={DiffMethod.WORDS}
        leftTitle="Original"
        rightTitle="Fixed"
        styles={{
          variables: {
            dark: {
              // background + chrome
              diffViewerBackground: "var(--bg-card)",
              diffViewerColor: "var(--text-primary)",
              codeFoldBackground: "var(--bg-elevated)",
              codeFoldContentColor: "var(--text-secondary)",
              codeFoldGutterBackground: "var(--bg-panel)",
              gutterBackground: "var(--bg-card)",
              gutterBackgroundDark: "var(--bg-panel)",
              gutterColor: "var(--text-tertiary)",
              emptyLineBackground: "var(--bg-card)",
              // diff tints
              addedBackground: "var(--diff-added-bg)",
              addedColor: "var(--text-primary)",
              addedGutterBackground: "var(--diff-added-bg)",
              addedGutterColor: "var(--text-secondary)",
              wordAddedBackground: "var(--diff-added-strong)",
              removedBackground: "var(--diff-removed-bg)",
              removedColor: "var(--text-primary)",
              removedGutterBackground: "var(--diff-removed-bg)",
              removedGutterColor: "var(--text-secondary)",
              wordRemovedBackground: "var(--diff-removed-strong)",
              // misc
              highlightBackground: "var(--accent-bg-subtle)",
              highlightGutterBackground: "var(--accent-bg-subtle)",
            },
          },
          contentText: {
            fontFamily:
              "var(--font-jetbrains), JetBrains Mono, ui-monospace, monospace",
            fontSize: "13px",
          },
          gutter: {
            padding: "0 var(--space-3)",
            fontFamily:
              "var(--font-jetbrains), JetBrains Mono, ui-monospace, monospace",
            fontSize: "12px",
          },
          titleBlock: {
            background: "var(--bg-panel)",
            color: "var(--text-secondary)",
            fontFamily: "var(--font-geist), Inter, system-ui, sans-serif",
            fontSize: "var(--text-sm)",
            fontWeight: 500,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            borderBottom: "1px solid var(--border-subtle)",
            padding: "var(--space-3) var(--space-4)",
          },
          line: {
            padding: "2px 0",
          },
        }}
      />
    </div>
  );
}
