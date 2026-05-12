"use client";

import { useCallback, useRef } from "react";
import MonacoEditor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

type Props = {
  value: string;
  onChange?: (next: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  ariaLabel?: string;
};

const THEME_ID = "genfix-dark";

/**
 * Read a `--token` from :root's computed styles. Used at theme-define time so
 * the Monaco palette tracks globals.css instead of duplicating hex literals.
 */
function cssVarHex(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!v) return fallback;
  // Monaco wants 6/8-digit hex strings without the leading "#".
  return v.startsWith("#") ? v.slice(1) : v;
}

function defineTheme(monaco: Monaco): void {
  monaco.editor.defineTheme(THEME_ID, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: cssVarHex("--text-primary", "ececf1") },
      { token: "comment", foreground: cssVarHex("--code-comment", "6e6e80"), fontStyle: "italic" },
      { token: "string", foreground: cssVarHex("--code-string", "c3e88d") },
      { token: "string.python", foreground: cssVarHex("--code-string", "c3e88d") },
      { token: "number", foreground: cssVarHex("--code-number", "f78c6c") },
      { token: "keyword", foreground: cssVarHex("--code-keyword", "c792ea") },
      { token: "keyword.python", foreground: cssVarHex("--code-keyword", "c792ea") },
      { token: "tag", foreground: cssVarHex("--code-decorator", "82aaff") },
      { token: "annotation", foreground: cssVarHex("--code-decorator", "82aaff") },
      { token: "decorator", foreground: cssVarHex("--code-decorator", "82aaff") },
      { token: "variable.predefined", foreground: cssVarHex("--code-self", "ffcb6b") },
      { token: "type", foreground: cssVarHex("--code-keyword", "c792ea") },
    ],
    colors: {
      "editor.background": "#" + cssVarHex("--bg-card", "1a1a24"),
      "editor.foreground": "#" + cssVarHex("--text-primary", "ececf1"),
      "editor.lineHighlightBackground": "#" + cssVarHex("--bg-card-hover", "20202c"),
      "editor.lineHighlightBorder": "#00000000",
      "editorLineNumber.foreground": "#" + cssVarHex("--text-tertiary", "5e5e6e"),
      "editorLineNumber.activeForeground": "#" + cssVarHex("--text-secondary", "9a9aa8"),
      "editorCursor.foreground": "#" + cssVarHex("--accent", "7c5cff"),
      "editor.selectionBackground": "#" + cssVarHex("--accent", "7c5cff") + "30",
      "editor.inactiveSelectionBackground": "#" + cssVarHex("--accent", "7c5cff") + "18",
      "editorIndentGuide.background1": "#" + cssVarHex("--border-subtle", "22222c"),
      "editorIndentGuide.activeBackground1": "#" + cssVarHex("--border-default", "2c2c38"),
      "editorWidget.background": "#" + cssVarHex("--bg-elevated", "24242f"),
      "editorWidget.border": "#" + cssVarHex("--border-default", "2c2c38"),
      "scrollbarSlider.background": "#" + cssVarHex("--border-default", "2c2c38") + "80",
      "scrollbarSlider.hoverBackground": "#" + cssVarHex("--border-strong", "3a3a48") + "c0",
      "scrollbarSlider.activeBackground": "#" + cssVarHex("--border-strong", "3a3a48"),
    },
  });
}

const COMMON_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  fontFamily: "var(--font-jetbrains), JetBrains Mono, ui-monospace, monospace",
  fontLigatures: true,
  fontSize: 14,
  lineHeight: 1.6 * 14,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  cursorBlinking: "smooth",
  cursorSmoothCaretAnimation: "on",
  renderLineHighlight: "line",
  renderLineHighlightOnlyWhenFocus: false,
  tabSize: 4,
  wordWrap: "off",
  padding: { top: 16, bottom: 16 },
  scrollbar: {
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8,
    useShadows: false,
  },
  overviewRulerLanes: 0,
  guides: { indentation: true, highlightActiveIndentation: true },
  contextmenu: false,
};

export function Editor({
  value,
  onChange,
  readOnly = false,
  placeholder,
  ariaLabel,
}: Props) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const beforeMount = useCallback((monaco: Monaco) => {
    defineTheme(monaco);
  }, []);

  const onMount: OnMount = useCallback((ed) => {
    editorRef.current = ed;
    if (ariaLabel) {
      ed.updateOptions({ ariaLabel });
    }
  }, [ariaLabel]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[var(--radius-md)] border border-subtle bg-card">
      <MonacoEditor
        height="100%"
        language="python"
        theme={THEME_ID}
        value={value}
        beforeMount={beforeMount}
        onMount={onMount}
        onChange={(v) => onChange?.(v ?? "")}
        options={{ ...COMMON_OPTIONS, readOnly }}
        loading={
          <div className="flex h-full items-center justify-center text-tertiary text-sm font-mono">
            loading editor…
          </div>
        }
      />
      {placeholder && !value && (
        <div
          className="pointer-events-none absolute left-[calc(var(--space-4)+44px)] top-[var(--space-4)] text-tertiary font-mono text-sm"
          aria-hidden="true"
        >
          {placeholder}
        </div>
      )}
    </div>
  );
}
