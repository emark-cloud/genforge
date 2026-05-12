"use client";

import { useCallback } from "react";
import { Download } from "lucide-react";

type Props = {
  filename: string;
  content: string;
  mimeType?: string;
  label?: string;
};

export function DownloadButton({
  filename,
  content,
  mimeType = "text/x-python",
  label = "Download",
}: Props) {
  const onClick = useCallback(() => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [filename, content, mimeType]);

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-default bg-card px-[var(--space-3)] py-[var(--space-2)] text-sm text-secondary hover:text-primary hover:bg-card-hover transition-colors duration-[var(--duration-fast)]"
    >
      <Download size={14} aria-hidden="true" />
      {label}
    </button>
  );
}
