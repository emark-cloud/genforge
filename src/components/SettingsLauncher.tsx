"use client";

import { useState } from "react";
import { Settings } from "lucide-react";
import { SettingsModal } from "./SettingsModal";

/**
 * Temporary launcher for Step 7 verification. The real gear lives in the
 * topbar starting in Step 9; this exists so the smoke-test page can open
 * the modal until then.
 */
export function SettingsLauncher() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open settings"
        className="inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-default bg-card px-[var(--space-3)] py-[var(--space-2)] text-sm text-secondary hover:text-primary hover:bg-card-hover transition-colors duration-[var(--duration-fast)]"
      >
        <Settings size={14} aria-hidden="true" />
        Settings
      </button>
      {open && <SettingsModal onClose={() => setOpen(false)} />}
    </>
  );
}
