"use client";

import { useEffect, useState } from "react";

/**
 * The CTA loading state per DESIGN §Motion rule 2 — *one* moving thing on the
 * screen while the LLM is thinking. Cycles a JetBrains Mono `·` through six
 * positions at 80ms intervals.
 */
export function Spinner({ className }: { className?: string }) {
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setI((n) => (n + 1) % 6);
    }, 80);
    return () => window.clearInterval(id);
  }, []);

  const frame = "······".slice(0, i + 1).padEnd(6, " ");

  return (
    <span
      className={`font-mono tabular-nums tracking-[0.1em] ${className ?? ""}`}
      aria-hidden="true"
    >
      {frame}
    </span>
  );
}
