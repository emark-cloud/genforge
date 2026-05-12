"use client";

import { Sparkles, Wrench } from "lucide-react";

export type TabId = "debug" | "generate";

type Props = {
  active: TabId;
  onChange: (next: TabId) => void;
};

const TABS: { id: TabId; label: string; Icon: typeof Wrench }[] = [
  { id: "debug", label: "Debug", Icon: Wrench },
  { id: "generate", label: "Generate", Icon: Sparkles },
];

/**
 * Debug / Generate switcher per DESIGN §Tabs.
 * Active tab: text fades to primary + a 2px violet underline draws in 180ms.
 * No background change.
 */
export function Tabs({ active, onChange }: Props) {
  return (
    <div role="tablist" aria-label="Workspace tabs" className="flex items-center gap-[var(--space-2)]">
      {TABS.map(({ id, label, Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(id)}
            className={`relative inline-flex items-center gap-[var(--space-2)] px-[var(--space-5)] py-[var(--space-3)] text-base transition-colors duration-[var(--duration-fast)] ${
              isActive ? "text-primary" : "text-secondary hover:text-primary"
            }`}
          >
            <Icon size={14} aria-hidden="true" />
            <span>{label}</span>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 left-[var(--space-5)] right-[var(--space-5)] h-[2px] origin-left transition-transform"
              style={{
                background: "var(--accent)",
                transform: isActive ? "scaleX(1)" : "scaleX(0)",
                transitionDuration: "var(--duration-base)",
                transitionTimingFunction: "var(--ease-out)",
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
