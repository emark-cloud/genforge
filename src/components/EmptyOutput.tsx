"use client";

type Props = {
  hint: string;
};

/**
 * Empty-state hero for the right-half output panel. The one place the display
 * serif gets to be theatrical (DESIGN §"Empty state on the output side").
 */
export function EmptyOutput({ hint }: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[var(--space-4)] text-center">
      <p className="font-display italic text-display text-secondary leading-none">
        waiting for code
      </p>
      <p className="text-sm text-tertiary max-w-[28ch]">{hint}</p>
    </div>
  );
}
