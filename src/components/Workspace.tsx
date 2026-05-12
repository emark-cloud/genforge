"use client";

import { useCallback, useEffect, useState } from "react";
import { Topbar } from "./Topbar";
import { DebugTab } from "./DebugTab";
import { GenerateTab } from "./GenerateTab";
import type { TabId } from "./Tabs";
import { useByok } from "@/hooks/useByok";
import type { Quota } from "@/lib/quota";

/**
 * Workspace shell — wires topbar, tab state, the BYOK indicator, and the
 * quota counter together. The two tab implementations live in their own
 * files; this file owns nothing except the shared state.
 *
 * Mobile guard: below 1024px we show a quiet "best on a wider screen" message.
 * That's per CLAUDE.md hard rule #8 — mobile is out of scope for v1.
 */
export function Workspace() {
  const byok = useByok();
  const [activeTab, setActiveTab] = useState<TabId>("debug");
  const [quota, setQuota] = useState<Quota | null>(null);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const onQuotaUpdate = useCallback((q: Quota) => setQuota(q), []);

  if (narrow) {
    return (
      <main className="grid min-h-svh place-items-center bg-canvas px-[var(--space-5)] text-center">
        <div className="flex flex-col items-center gap-[var(--space-3)]">
          <p className="font-display italic text-display text-secondary leading-none">
            best on a wider screen
          </p>
          <p className="text-sm text-tertiary max-w-[32ch]">
            GenForge needs a code editor and a side-by-side diff. Open this on a
            laptop or desktop (≥1024px).
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="flex h-svh min-h-0 flex-col bg-canvas">
      <Topbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        byok={byok}
        quota={quota}
      />
      <main className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "debug" ? (
          <DebugTab byok={byok} quota={quota} onQuotaUpdate={onQuotaUpdate} />
        ) : (
          <GenerateTab />
        )}
      </main>
    </div>
  );
}
