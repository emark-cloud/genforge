"use client";

import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";

type Props = {
  text: string;
  label?: string;
};

export function CopyButton({ text, label = "Copy" }: Props) {
  const [copied, setCopied] = useState(false);

  const onClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Browser may deny clipboard access; ignore silently — the Download
      // button is the always-available fallback.
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={copied ? "Copied" : label}
      className="inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-default bg-card px-[var(--space-3)] py-[var(--space-2)] text-sm text-secondary hover:text-primary hover:bg-card-hover transition-colors duration-[var(--duration-fast)]"
    >
      {copied ? (
        <Check size={14} aria-hidden="true" className="text-[var(--ok)]" />
      ) : (
        <Copy size={14} aria-hidden="true" />
      )}
      {copied ? "Copied" : label}
    </button>
  );
}
