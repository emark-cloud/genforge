"use client";

import { Tabs, type TabId } from "./Tabs";
import { FreeTierIndicator } from "./FreeTierIndicator";
import { SettingsLauncher } from "./SettingsLauncher";
import type { ActiveByok } from "@/lib/keys";
import type { Quota } from "@/lib/quota";
import { isExhausted } from "./FreeTierIndicator";

type Props = {
  activeTab: TabId;
  onTabChange: (next: TabId) => void;
  byok: ActiveByok | null;
  quota: Quota | null;
};

/**
 * 56px top bar — wordmark left, tabs centered, indicator + gear right.
 * Per DESIGN §Layout; the wordmark is Instrument Serif italic with a slightly
 * enlarged G as a flourish (yes, *Gen*Forge — italic-F is reserved for the favicon).
 */
export function Topbar({ activeTab, onTabChange, byok, quota }: Props) {
  const exhausted = isExhausted(byok, quota);

  return (
    <header
      className="h-[56px] shrink-0 border-b border-subtle bg-panel"
      role="banner"
    >
      <div className="grid h-full grid-cols-[1fr_auto_1fr] items-center px-[var(--space-5)]">
        <div className="flex items-center">
          <span className="font-display italic text-xl tracking-tight text-primary select-none">
            <span className="inline-block scale-110 origin-bottom-left">G</span>
            <span>enForge</span>
          </span>
        </div>
        <Tabs active={activeTab} onChange={onTabChange} />
        <div className="flex items-center justify-end gap-[var(--space-4)]">
          <FreeTierIndicator byok={byok} quota={quota} />
          <SettingsLauncher pulse={exhausted} />
        </div>
      </div>
    </header>
  );
}
