/**
 * Token smoke-test page. Renders one of each major surface from DESIGN.md so
 * we can eyeball that colors, fonts, focus ring, and the violet accent all
 * land correctly before we start composing real components in step 9+.
 *
 * Replace this once the workspace shell exists.
 */
import { FreeTierSmoke } from "@/components/FreeTierSmoke";

export default function Home() {
  return (
    <main className="flex flex-col items-start gap-8 px-8 py-16 max-w-3xl">
      {/* Wordmark — Instrument Serif italic with the F slightly oversized */}
      <h1 className="font-display italic text-display tracking-tight">
        <span className="inline-block scale-110 origin-bottom-left">G</span>
        <span>enForge</span>
      </h1>

      {/* Section label */}
      <span className="label-caps">Token check</span>

      {/* Surfaces */}
      <div className="flex flex-col gap-3 w-full">
        <div className="bg-panel rounded-lg p-5 border border-subtle">
          panel surface (--bg-panel)
        </div>
        <div className="bg-card rounded-lg p-5 border border-subtle">
          card surface (--bg-card)
        </div>
        <div className="bg-elevated rounded-lg p-5 border border-default">
          elevated surface (--bg-elevated)
        </div>
      </div>

      {/* Buttons */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="h-10 px-5 rounded-pill bg-accent text-on-accent text-base font-medium transition-colors duration-[120ms] hover:bg-accent-hover active:bg-accent-pressed"
        >
          Primary CTA
        </button>
        <button
          type="button"
          className="h-10 px-5 rounded-md bg-card border border-default text-primary text-base font-medium hover:bg-card-hover transition-colors duration-[120ms]"
        >
          Secondary
        </button>
        <button
          type="button"
          className="h-10 px-3 text-secondary text-base hover:text-primary transition-colors duration-[120ms]"
        >
          Ghost
        </button>
      </div>

      {/* Step 8 smoke-test harness: free-tier indicator + gear + CTA. */}
      <FreeTierSmoke />

      {/* Input */}
      <input
        type="text"
        placeholder="Tab here, then notice the focus ring"
        className="h-10 w-full px-4 rounded-md bg-card border border-default text-primary placeholder:text-tertiary hover:border-strong transition-colors duration-[120ms]"
      />

      {/* Mono sample (editor preview) */}
      <pre className="font-mono text-md text-primary bg-card rounded-lg p-5 border border-subtle w-full">
        <span style={{ color: "var(--code-comment)" }}>
          {"# v0.1.0\n# { \"Depends\": \"py-genlayer:1jb45...\" }\n"}
        </span>
        <span style={{ color: "var(--code-keyword)" }}>from</span> genlayer{" "}
        <span style={{ color: "var(--code-keyword)" }}>import</span> *{"\n"}
        <span style={{ color: "var(--code-decorator)" }}>@gl.public.write</span>
        {"\n"}
        <span style={{ color: "var(--code-keyword)" }}>def</span> set_data(
        <span style={{ color: "var(--code-self)" }}>self</span>, key:{" "}
        <span style={{ color: "var(--code-keyword)" }}>str</span>):
      </pre>

      <p className="text-secondary text-base">
        Body text in <code className="font-mono text-md text-primary">--text-secondary</code>.
        Empty-state hero below.
      </p>

      <p className="font-display italic text-display text-secondary">
        waiting for code
      </p>
    </main>
  );
}
