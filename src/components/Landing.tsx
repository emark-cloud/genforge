import Link from "next/link";
import { ArrowRight, GitBranch, Wrench, Sparkles } from "lucide-react";

/**
 * Landing page — quiet, editorial, dark. The wordmark and one big italic-serif
 * moment carry the page; everything else is restrained per DESIGN.md.
 *
 * Violet appears in exactly one place on this surface: the primary "Open
 * workspace" CTA. Everything else is text, hairlines, and the canvas.
 */
export function Landing() {
  return (
    <div className="flex min-h-svh flex-col bg-canvas text-primary">
      <LandingHeader />
      <main className="flex-1">
        <Hero />
        <Features />
        <HowItWorks />
      </main>
      <LandingFooter />
    </div>
  );
}

function LandingHeader() {
  return (
    <header className="reveal-topbar h-[56px] shrink-0 border-b border-subtle bg-panel">
      <div className="mx-auto flex h-full max-w-[1200px] items-center justify-between px-[var(--space-5)]">
        <Link href="/" className="select-none rounded-[var(--radius-sm)]">
          <span className="font-display italic text-xl tracking-tight text-primary">
            <span className="inline-block scale-110 origin-bottom-left">G</span>
            <span>enForge</span>
          </span>
        </Link>
        <nav className="flex items-center gap-[var(--space-5)]">
          <a
            href="https://github.com/emark-cloud/genforge"
            target="_blank"
            rel="noreferrer"
            className="hidden text-sm text-secondary transition-colors duration-[var(--duration-fast)] hover:text-primary sm:inline"
          >
            GitHub
          </a>
          <Link
            href="/workspace"
            className="inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-pill)] border border-default px-[var(--space-4)] py-[6px] text-sm text-primary transition-colors duration-[var(--duration-fast)] hover:border-strong hover:bg-card"
          >
            Open workspace
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="reveal-workspace mx-auto flex max-w-[1200px] flex-col items-start gap-[var(--space-6)] px-[var(--space-5)] pt-[var(--space-8)] pb-[var(--space-7)] sm:pt-[96px] sm:pb-[var(--space-8)]">
      <span className="label-caps">A workshop for GenLayer Intelligent Contracts</span>

      <h1 className="font-display italic leading-[1.02] tracking-tight text-primary text-[clamp(2.75rem,7vw,5.5rem)]">
        Fix what&apos;s broken.
        <br />
        <span className="text-secondary">Forge what&apos;s new.</span>
      </h1>

      <p className="max-w-[58ch] text-md text-secondary leading-[1.6]">
        Paste a broken Intelligent Contract and get a surgical fix with the
        diff and the reasoning. Or describe a new contract in plain English
        and get a complete, header-correct Python file back — types, decorators,
        and equivalence principles included.
      </p>

      <div className="flex flex-wrap items-center gap-[var(--space-4)] pt-[var(--space-2)]">
        <Link
          href="/workspace"
          className="inline-flex items-center justify-center gap-[var(--space-2)] h-11 rounded-[var(--radius-pill)] bg-accent px-[var(--space-6)] text-md font-medium text-on-accent transition-colors duration-[var(--duration-fast)] hover:bg-accent-hover active:bg-accent-pressed"
        >
          Open workspace
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
        <a
          href="https://github.com/emark-cloud/genforge"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-[var(--space-2)] text-sm text-secondary transition-colors duration-[var(--duration-fast)] hover:text-primary"
        >
          <GitBranch size={14} aria-hidden="true" />
          View source
        </a>
      </div>

      <p className="text-sm text-tertiary">
        Free to try — 5 calls / day from your IP. Paste your own Anthropic,
        OpenAI, or Gemini key for unlimited.
      </p>
    </section>
  );
}

function Features() {
  return (
    <section className="mx-auto grid max-w-[1200px] gap-[var(--space-5)] px-[var(--space-5)] py-[var(--space-7)] md:grid-cols-2">
      <FeatureCard
        icon={<Wrench size={14} aria-hidden="true" />}
        title="Debug"
        lede="Paste the contract that won't compile and the error you saw. Get back a side-by-side diff, a short explanation, and a list of every change with the why."
      >
        <CodeFlourish kind="debug" />
      </FeatureCard>

      <FeatureCard
        icon={<Sparkles size={14} aria-hidden="true" />}
        title="Generate"
        lede="Describe the contract you want — a sealed-bid auction, a prediction market, an LLM-judged review. Get a complete Python file with the right header, types, and equivalence principle."
      >
        <CodeFlourish kind="generate" />
      </FeatureCard>
    </section>
  );
}

function FeatureCard({
  icon,
  title,
  lede,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <article className="flex flex-col gap-[var(--space-4)] rounded-[var(--radius-lg)] border border-subtle bg-card p-[var(--space-6)]">
      <div className="flex items-center gap-[var(--space-2)] text-secondary">
        {icon}
        <span className="label-caps">{title}</span>
      </div>
      <p className="text-md text-primary leading-[1.5]">{lede}</p>
      <div className="mt-[var(--space-1)]">{children}</div>
    </article>
  );
}

function CodeFlourish({ kind }: { kind: "debug" | "generate" }) {
  if (kind === "debug") {
    return (
      <pre className="overflow-hidden rounded-[var(--radius-md)] border border-subtle bg-elevated p-[var(--space-3)] font-mono text-xs leading-[1.6] text-primary">
        <span
          className="block px-[var(--space-2)]"
          style={{ background: "var(--diff-removed-bg)" }}
        >
          <span className="text-tertiary">- </span>
          balance: <span style={{ color: "var(--code-keyword)" }}>float</span>
        </span>
        <span
          className="block px-[var(--space-2)]"
          style={{ background: "var(--diff-added-bg)" }}
        >
          <span className="text-tertiary">+ </span>
          balance: <span style={{ color: "var(--code-keyword)" }}>u256</span>
        </span>
        <span className="block px-[var(--space-2)] text-tertiary">
          {"  "}<span style={{ color: "var(--code-comment)" }}>
            # GenLayer has no float type — pick u256.
          </span>
        </span>
      </pre>
    );
  }

  return (
    <pre className="overflow-hidden rounded-[var(--radius-md)] border border-subtle bg-elevated p-[var(--space-3)] font-mono text-xs leading-[1.6] text-primary">
      <span className="block">
        <span style={{ color: "var(--code-decorator)" }}>@gl.public.write</span>
      </span>
      <span className="block">
        <span style={{ color: "var(--code-keyword)" }}>def</span>{" "}
        bid(<span style={{ color: "var(--code-self)" }}>self</span>) -&gt;{" "}
        <span style={{ color: "var(--code-keyword)" }}>None</span>:
      </span>
      <span className="block pl-[var(--space-3)]">
        <span style={{ color: "var(--code-self)" }}>self</span>.bids[
        <span style={{ color: "var(--code-decorator)" }}>gl.message</span>
        .sender_address] = amount
      </span>
    </pre>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Bring code or a brief",
      body: "Drop a broken .py contract in the Debug tab, or describe the contract you need in the Generate tab.",
    },
    {
      n: "02",
      title: "We ask the model",
      body: "The system prompt bakes in the GenLayer hard rules — pinned Depends header, decorator catalog, nondet patterns, equivalence principles, the common bugs.",
    },
    {
      n: "03",
      title: "Read the diff, copy the file",
      body: "Side-by-side diff and a plain-English explanation for Debug. Full contract with usage notes and constructor args for Generate. Copy or download.",
    },
  ];

  return (
    <section className="border-y border-subtle bg-panel">
      <div className="mx-auto max-w-[1200px] px-[var(--space-5)] py-[var(--space-8)]">
        <h2 className="font-display italic text-xl text-primary leading-none mb-[var(--space-6)]">
          How it works
        </h2>
        <ol className="grid gap-[var(--space-6)] md:grid-cols-3">
          {steps.map(({ n, title, body }) => (
            <li key={n} className="flex flex-col gap-[var(--space-2)]">
              <span className="font-mono text-xs text-tertiary tracking-wider">
                {n}
              </span>
              <h3 className="text-md font-medium text-primary">{title}</h3>
              <p className="text-sm text-secondary leading-[1.6]">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-subtle">
      <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-[var(--space-3)] px-[var(--space-5)] py-[var(--space-5)] sm:flex-row sm:items-center">
        <span className="text-xs text-tertiary">
          MIT licensed. Built for GenLayer contract authors.
        </span>
        <div className="flex items-center gap-[var(--space-5)] text-xs text-tertiary">
          <a
            href="https://github.com/emark-cloud/genforge"
            target="_blank"
            rel="noreferrer"
            className="transition-colors duration-[var(--duration-fast)] hover:text-primary"
          >
            github.com/emark-cloud/genforge
          </a>
          <Link
            href="/workspace"
            className="transition-colors duration-[var(--duration-fast)] hover:text-primary"
          >
            Open workspace →
          </Link>
        </div>
      </div>
    </footer>
  );
}
