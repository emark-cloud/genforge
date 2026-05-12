"use client";

import { Editor } from "./Editor";
import { Markdown } from "./Markdown";
import { CopyButton } from "./CopyButton";
import { DownloadButton } from "./DownloadButton";

export type ConstructorArg = {
  name: string;
  type: string;
  description: string;
};

export type GenerateResult = {
  code: string;
  usage_notes: string;
  constructor_args?: ConstructorArg[];
};

type Props = {
  result: GenerateResult;
};

export function GenerateOutput({ result }: Props) {
  const args = result.constructor_args ?? [];
  return (
    <div className="flex h-full flex-col gap-[var(--space-4)]">
      <div className="flex items-center justify-between gap-[var(--space-3)]">
        <span className="label-caps">Generated contract</span>
        <div className="flex items-center gap-[var(--space-2)]">
          <CopyButton text={result.code} label="Copy" />
          <DownloadButton filename="contract.py" content={result.code} />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <Editor value={result.code} readOnly ariaLabel="Generated contract" />
      </div>

      <div className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] border border-subtle bg-card p-[var(--space-5)]">
        <span className="label-caps">Usage notes</span>
        <Markdown>{result.usage_notes || "_No usage notes returned._"}</Markdown>
        {args.length > 0 && (
          <div className="flex flex-col gap-[var(--space-2)] mt-[var(--space-2)]">
            <span className="label-caps">Constructor args</span>
            <ul className="flex flex-col gap-[var(--space-2)]">
              {args.map((a, i) => (
                <li
                  key={i}
                  className="flex flex-col gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-subtle bg-elevated p-[var(--space-3)]"
                >
                  <span className="text-base text-primary">
                    <span className="font-mono">{a.name}</span>
                    <span className="text-tertiary">: </span>
                    <span className="font-mono text-secondary">{a.type}</span>
                  </span>
                  <span className="text-sm text-secondary">{a.description}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
