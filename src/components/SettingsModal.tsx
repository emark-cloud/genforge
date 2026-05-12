"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";
import type { ProviderName } from "@/lib/providers/types";
import { DEFAULT_MODELS, MODEL_OPTIONS } from "@/lib/models";
import {
  ALL_PROVIDERS,
  clearAll,
  clearKey,
  getCurrentProvider,
  getKey,
  getModel,
  setCurrentProvider,
  setKey,
  setModel,
} from "@/lib/keys";

type Props = {
  onClose: () => void;
  /** Fires whenever a key/model/active provider changes, so the host page can re-read state. */
  onChange?: () => void;
};

const PROVIDER_LABEL: Record<ProviderName, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
};

const FOCUSABLE =
  "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";

export function SettingsModal({ onClose, onChange }: Props) {
  const [keys, setKeys] = useState<Record<ProviderName, string>>(() => ({
    anthropic: getKey("anthropic"),
    openai: getKey("openai"),
    gemini: getKey("gemini"),
  }));
  const [models, setModels] = useState<Record<ProviderName, string>>(() => ({
    anthropic: getModel("anthropic"),
    openai: getModel("openai"),
    gemini: getModel("gemini"),
  }));
  const [active, setActive] = useState<ProviderName | null>(() =>
    getCurrentProvider(),
  );
  const [tab, setTab] = useState<ProviderName>(
    () => getCurrentProvider() ?? "anthropic",
  );
  const [reveal, setReveal] = useState<Record<ProviderName, boolean>>({
    anthropic: false,
    openai: false,
    gemini: false,
  });

  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const notifyChange = useCallback(() => {
    onChange?.();
  }, [onChange]);

  // Capture opener + autofocus the close button on mount; restore focus on unmount.
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const id = window.setTimeout(() => {
      const node = dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]");
      node?.focus();
    }, 0);
    return () => {
      window.clearTimeout(id);
      openerRef.current?.focus?.();
    };
  }, []);

  // Esc + Tab focus trap.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const list = Array.from(nodes).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const commitKey = (p: ProviderName, value: string) => {
    const trimmed = value.trim();
    if (trimmed) {
      setKey(p, trimmed);
      setActive(getCurrentProvider());
    } else {
      clearKey(p);
      if (active === p) setActive(null);
    }
    notifyChange();
  };

  const handleClearKey = (p: ProviderName) => {
    clearKey(p);
    setKeys((k) => ({ ...k, [p]: "" }));
    if (active === p) setActive(null);
    notifyChange();
  };

  const handleClearAll = () => {
    clearAll();
    setKeys({ anthropic: "", openai: "", gemini: "" });
    setModels({
      anthropic: DEFAULT_MODELS.anthropic,
      openai: DEFAULT_MODELS.openai,
      gemini: DEFAULT_MODELS.gemini,
    });
    setActive(null);
    notifyChange();
  };

  const handleModelChange = (p: ProviderName, m: string) => {
    setModel(p, m);
    setModels((s) => ({ ...s, [p]: m }));
    notifyChange();
  };

  const handleMakeActive = (p: ProviderName) => {
    if (!keys[p].trim()) return;
    setCurrentProvider(p);
    setActive(p);
    notifyChange();
  };

  const footerText = useMemo(() => {
    if (!active) return "Free tier — using GenForge's server key.";
    return `Currently using your ${PROVIDER_LABEL[active]} key (${models[active]}).`;
  }, [active, models]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-[var(--space-4)]"
      role="presentation"
    >
      <div
        className="absolute inset-0 bg-canvas/80"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="relative w-full max-w-[480px] rounded-[var(--radius-lg)] border border-default bg-panel shadow-[0_24px_64px_rgba(0,0,0,0.5)]"
        style={{ animation: "settings-in var(--duration-base) var(--ease-out)" }}
      >
        <header className="flex items-center justify-between px-[var(--space-5)] py-[var(--space-4)] border-b border-subtle">
          <h2 id="settings-title" className="text-md font-medium text-primary">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            data-autofocus
            className="rounded-[var(--radius-sm)] p-[var(--space-1)] text-secondary hover:text-primary hover:bg-card-hover transition-colors duration-[var(--duration-fast)]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="px-[var(--space-5)] py-[var(--space-5)] flex flex-col gap-[var(--space-5)]">
          <p className="text-sm text-secondary leading-relaxed">
            Bring your own key for unlimited use. Your key is stored in your
            browser only — it&apos;s sent to GenForge on the single request that
            uses it and never saved server-side.
          </p>

          {/* Segmented provider control */}
          <div
            role="tablist"
            aria-label="BYOK provider"
            className="flex items-center gap-[var(--space-1)] rounded-[var(--radius-md)] border border-subtle bg-card p-[var(--space-1)]"
          >
            {ALL_PROVIDERS.map((p) => {
              const isActive = tab === p;
              const hasKey = keys[p].trim().length > 0;
              return (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`settings-panel-${p}`}
                  onClick={() => setTab(p)}
                  className={`flex-1 inline-flex items-center justify-center gap-[var(--space-1)] rounded-[var(--radius-sm)] px-[var(--space-3)] py-[var(--space-2)] text-sm font-medium transition-colors duration-[var(--duration-fast)] ${
                    isActive
                      ? "bg-elevated text-primary"
                      : "text-secondary hover:text-primary"
                  }`}
                >
                  <span>{PROVIDER_LABEL[p]}</span>
                  {hasKey && (
                    <span
                      aria-hidden="true"
                      className="size-[6px] rounded-full"
                      style={{
                        background:
                          active === p ? "var(--accent)" : "var(--border-strong)",
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab panels */}
          {ALL_PROVIDERS.map((p) => {
            if (tab !== p) return null;
            const value = keys[p];
            const isActive = active === p;
            const placeholder =
              p === "anthropic"
                ? "sk-ant-…"
                : p === "openai"
                  ? "sk-…"
                  : "AIza…";
            return (
              <div
                key={p}
                id={`settings-panel-${p}`}
                role="tabpanel"
                className="flex flex-col gap-[var(--space-4)]"
              >
                <div className="flex flex-col gap-[var(--space-2)]">
                  <label htmlFor={`key-${p}`} className="label-caps">
                    {PROVIDER_LABEL[p]} API Key
                  </label>
                  <div className="flex items-center gap-[var(--space-2)]">
                    <div className="relative flex-1">
                      <input
                        id={`key-${p}`}
                        type={reveal[p] ? "text" : "password"}
                        spellCheck={false}
                        autoComplete="off"
                        value={value}
                        placeholder={placeholder}
                        onChange={(e) =>
                          setKeys((k) => ({ ...k, [p]: e.target.value }))
                        }
                        onBlur={(e) => commitKey(p, e.target.value)}
                        className="w-full rounded-[var(--radius-sm)] border border-default bg-card px-[var(--space-3)] py-[var(--space-2)] pr-[var(--space-7)] font-mono text-sm text-primary placeholder:text-tertiary transition-colors duration-[var(--duration-fast)] hover:border-strong"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setReveal((r) => ({ ...r, [p]: !r[p] }))
                        }
                        aria-label={reveal[p] ? "Hide key" : "Reveal key"}
                        aria-pressed={reveal[p]}
                        className="absolute right-[var(--space-2)] top-1/2 -translate-y-1/2 rounded-[var(--radius-sm)] p-[var(--space-1)] text-tertiary hover:text-secondary transition-colors duration-[var(--duration-fast)]"
                      >
                        {reveal[p] ? (
                          <EyeOff size={14} aria-hidden="true" />
                        ) : (
                          <Eye size={14} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleClearKey(p)}
                      disabled={!value}
                      className="rounded-[var(--radius-sm)] border border-default bg-card px-[var(--space-3)] py-[var(--space-2)] text-sm text-secondary hover:text-primary hover:border-strong disabled:opacity-40 disabled:hover:text-secondary disabled:hover:border-default transition-colors duration-[var(--duration-fast)]"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-[var(--space-2)]">
                  <label htmlFor={`model-${p}`} className="label-caps">
                    Model
                  </label>
                  <select
                    id={`model-${p}`}
                    value={models[p]}
                    onChange={(e) => handleModelChange(p, e.target.value)}
                    className="rounded-[var(--radius-sm)] border border-default bg-card px-[var(--space-3)] py-[var(--space-2)] font-mono text-sm text-primary transition-colors duration-[var(--duration-fast)] hover:border-strong"
                  >
                    {MODEL_OPTIONS[p].map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => handleMakeActive(p)}
                    disabled={!value.trim() || isActive}
                    className={`inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] px-[var(--space-3)] py-[var(--space-2)] text-sm font-medium transition-colors duration-[var(--duration-fast)] ${
                      isActive
                        ? "bg-[var(--accent-bg-subtle)] text-[var(--accent)] cursor-default"
                        : "border border-default bg-card text-secondary hover:text-primary hover:border-strong disabled:opacity-40 disabled:hover:text-secondary disabled:hover:border-default"
                    }`}
                  >
                    {isActive ? (
                      <>
                        <Check size={14} aria-hidden="true" />
                        Active
                      </>
                    ) : (
                      "Use this provider"
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <footer className="flex items-center justify-between gap-[var(--space-3)] px-[var(--space-5)] py-[var(--space-4)] border-t border-subtle">
          <p className="text-sm text-secondary truncate">{footerText}</p>
          <button
            type="button"
            onClick={handleClearAll}
            className="shrink-0 rounded-[var(--radius-sm)] px-[var(--space-3)] py-[var(--space-2)] text-sm text-secondary hover:text-[var(--error)] transition-colors duration-[var(--duration-fast)]"
          >
            Clear all
          </button>
        </footer>
      </div>
    </div>
  );
}
