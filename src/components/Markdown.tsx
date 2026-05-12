"use client";

import ReactMarkdown from "react-markdown";

/**
 * Minimal styled wrapper around react-markdown for the LLM "explanation" and
 * "usage_notes" fields. No GFM, no images — model output is plain prose with
 * occasional `inline code` and bullet lists.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-genforge">
      <ReactMarkdown
        components={{
          p: ({ children }) => (
            <p className="text-base text-primary leading-relaxed">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-[var(--space-5)] flex flex-col gap-[var(--space-1)] text-base text-primary">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-[var(--space-5)] flex flex-col gap-[var(--space-1)] text-base text-primary">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          h1: ({ children }) => (
            <h3 className="text-lg font-medium text-primary mt-[var(--space-4)]">
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h3 className="text-md font-medium text-primary mt-[var(--space-4)]">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="label-caps mt-[var(--space-3)]">{children}</h4>
          ),
          code: ({ children, className }) => {
            // Inline code only — block code from the model would be very weird in
            // an explanation field; if it shows up we still render reasonably.
            const isBlock = className?.includes("language-");
            if (isBlock) {
              return (
                <pre className="font-mono text-sm bg-elevated border border-subtle rounded-[var(--radius-sm)] p-[var(--space-3)] overflow-x-auto">
                  <code>{children}</code>
                </pre>
              );
            }
            return (
              <code
                className="font-mono text-sm px-[var(--space-1)] py-[1px] rounded-[var(--radius-sm)]"
                style={{ background: "var(--accent-bg-subtle)", color: "var(--text-primary)" }}
              >
                {children}
              </code>
            );
          },
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] hover:underline"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong className="font-medium text-primary">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-secondary">{children}</em>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
