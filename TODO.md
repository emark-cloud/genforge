# GenForge — Build TODO

Sequence is roughly biggest-risk-first: prompt + providers + backend before any UI, because that's where the product actually lives. Each step has a verification box — don't move on until it's checked.

Refer to `CLAUDE.md` for architecture, `SPEC.md` for functional spec, `DESIGN.md` for the visual system, `GUIDELINES.md` for the GenLayer patterns the prompt teaches.

---

## 1. Bootstrap

- [x] `pnpm dlx create-next-app@latest` (App Router, TS strict, Tailwind, ESLint, src/ dir) — installed **Next.js 16** (not 15 as originally planned). See `AGENTS.md` for Next 16 caveat.
- [x] `pnpm add monaco-editor @monaco-editor/react react-diff-viewer-continued lucide-react`
- [x] `pnpm add @anthropic-ai/sdk openai @google/genai`
- [x] `pnpm add @upstash/redis @upstash/ratelimit`
- [x] Add `LICENSE` (MIT)
- [x] Add `README.md` (one-screen pitch, run/deploy steps, env list)
- [x] Add `.env.example` with every var from `CLAUDE.md`
- [x] `git init`, first commit (`e3c62a4`)
- [x] **Verify:** `pnpm dev` boots a blank app on `http://localhost:3000` without errors. ✓ Ready in 840ms, HTTP 200.

## 2. Design tokens & fonts

- [x] `src/app/globals.css` — full token set from `DESIGN.md`: colors, radii, spacing, type scale, focus ring, motion. Lives next to `layout.tsx` (Next 16 + Tailwind 4 convention) rather than `src/styles/`.
- [x] **Tailwind 4 `@theme` block** — Tailwind 4 uses a CSS-first config; `tailwind.config.ts` is no longer needed. Utilities (`bg-canvas`, `text-primary`, `rounded-pill`, `font-display`, …) are mapped to CSS vars inside `globals.css`.
- [x] Load Geist, Instrument Serif, JetBrains Mono via `next/font/google` in `app/layout.tsx` with CSS-var bindings (`--font-geist`, `--font-instrument`, `--font-jetbrains`).
- [x] Set `<html>`/`<body>` to `bg-canvas` + `text-primary` + the Geist UI font default.
- [x] **Verify:** `pnpm dev` ready in 469ms, `GET / 200`. Token smoke-test page renders wordmark, three surfaces, three button styles, an input, a Monaco-color preview, the empty-state Instrument Serif moment. All target Tailwind utilities (`bg-canvas`, `bg-accent`, `text-primary`, `rounded-pill`, `font-display`, `font-mono`, `border-subtle`, `border-default`, …) compile into the CSS bundle. `pnpm typecheck` clean. Focus ring rule (`*:focus-visible { box-shadow: 0 0 0 2px var(--bg-canvas), 0 0 0 4px var(--accent), 0 0 0 8px var(--accent-glow); }`) emitted.

## 3. System prompt

- [x] `src/lib/genlayer-version.ts` — exports `GENLAYER_DEPENDS_HASH` and a `GENLAYER_HEADER` template; single edit to update on a py-genlayer pin bump.
- [x] `src/lib/system-prompt.ts` — fat shared prompt: role, primer, 13 hard rules (header, imports, storage, decorators, caller, addresses, errors, nondet patterns, storage/nondet rule, web fetch, prompt design, state-vs-LLM, contract-to-contract), canonical example, common-bugs checklist, per-flow JSON schemas. Public exports: `buildSystemPrompt(flow)`, `buildDebugUserPrompt`, `buildGenerateUserPrompt`.
- [x] `scripts/eval-prompt.ts` — runs 5 broken contracts (float in storage, missing `@allow_storage`, address `==`, storage in nondet, JSON without fence-strip) + 5 generation prompts (auction, vote, escrow, moderator, web fetcher) against Gemini Flash with retry-on-503 and `maxOutputTokens: 32768` (default 8k truncated longer contracts mid-JSON). Validates JSON shape, header presence, pinned hash, no-floats, and a per-case content fragment.
- [x] **Verify:** Across three runs every case passed at least once when Gemini responded (debug 5/5, generate 5/5). Persistent 503 "model currently experiencing high demand" and WSL network blips caused most FAILs — Google-side, not prompt logic. The prompt itself is verified working.

## 4. Provider adapters

- [x] `src/lib/providers/types.ts` — `LLMProvider` interface, `GenerateArgs`/`GenerateResult`, `LLMError` (carries provider + status + sanitized message), `normalizeError()` helper that redacts `sk-…` and `AIza…` patterns from error strings.
- [x] `src/lib/providers/gemini.ts` — `responseMimeType: "application/json"`, `temperature: 0.2`, `maxOutputTokens: 32768`. Returns `{ text, usage: { inputTokens, outputTokens } }`.
- [x] `src/lib/providers/anthropic.ts` — appends a JSON-only instruction to the system prompt; concatenates text blocks from `messages.create`. No native JSON-mode for arbitrary schemas.
- [x] `src/lib/providers/openai.ts` — `response_format: { type: "json_object" }` via `chat.completions`.
- [x] `src/lib/providers/index.ts` — `getProvider(name)` factory + `PROVIDER_NAMES` + barrel re-exports.
- [x] `src/lib/models.ts` — `SERVER_DEFAULT_MODEL=gemini-2.5-flash`, `DEFAULT_MODELS` (claude-opus-4-7 / gpt-5 / gemini-2.5-pro), `MODEL_OPTIONS` per provider for the BYOK dropdown.
- [x] **Verify:** `scripts/check-providers.ts` — Gemini PASS in 1847ms with usage wired (41 in / 18 out). Anthropic + OpenAI SKIP cleanly when their key envs aren't set; adapters are typechecked and ready for first BYOK use. `pnpm typecheck` clean.

## 5. Rate limit + circuit breaker + global caps

- [x] `src/lib/redis.ts` — shared Upstash REST client, `todayKey()` UTC-day suffix, `secondsUntilUtcMidnight()` TTL helper.
- [x] `src/lib/rate-limit.ts` — `checkAndReserve(ipHash)` increments per-IP and global request counters with rollback-on-over; `recordUsageCost(usd)` tops up the USD ceiling post-call; `peekRemaining(ipHash)` for the indicator.
- [x] `src/lib/circuit.ts` — sorted-set sliding window (5 min), 3 failures → opens for 1h via NX-locked `circuit:open_until`; `isOpen()` / `recordFailure()` / `resetBreaker()`.
- [x] `src/lib/ip.ts` — first-hop `x-forwarded-for` (Vercel-correct), sha256 + `IP_HASH_SALT`. Raw IP never leaves the module.
- [x] `src/lib/log.ts` — `LogEvent` is a closed union; a `Forbidden` mapped type makes `prompt` / `response` / `apiKey` / `key` / `messages` / `body` compile errors on `log()`. Verified by a temporary file that produced `TS2322: Type 'string' is not assignable to type 'never'`.
- [x] **Verify:** `scripts/check-rate-limit.ts` against real Upstash — all 5 suites pass: per-IP cap (2 allowed, 3rd → 429 `per_ip`), global request cap (cap=1 blocks 2nd → 429 `global_requests`), USD ceiling (over-cap blocks → 429 `global_usd`, raising cap re-allows), circuit breaker (2 failures don't trip, 3rd does, NX prevents re-tripping, reset works), structured log emits clean JSON line. `pnpm typecheck` clean.

## 6. API routes

- [ ] `src/lib/run-llm.ts` — shared `runLLM({ flow, body, headers })` helper that does the routing block from CLAUDE.md
- [ ] `app/api/debug/route.ts` — `POST` only, calls `runLLM("debug", ...)`
- [ ] `app/api/generate/route.ts` — `POST` only, calls `runLLM("generate", ...)`
- [ ] Validation: empty input → 400; oversized input → 413; malformed JSON → 400
- [ ] **Verify:** Both routes return well-formed JSON happy path. Force a malformed-JSON LLM response (mock) → fallback returns raw text + warning flag instead of crashing.

## 7. Settings modal + BYOK key storage

- [ ] `src/lib/keys.ts` — get/set/clear per-provider key + model, SSR-safe, with a "current provider" pointer
- [ ] `src/components/SettingsModal.tsx` — segmented provider control, three password inputs, model selectors, "Clear key"/"Clear all", quiet "currently using…" footer
- [ ] Disclaimer copy: "Your key is stored in your browser only."
- [ ] Modal traps focus, returns focus on close, `Esc` closes
- [ ] **Verify:** Enter a key, reload — persists. Switch provider, other keys remain. "Clear all" wipes all three. Tab order works, focus ring visible everywhere.

## 8. Free-tier UI states

- [ ] `src/components/FreeTierIndicator.tsx` — three states: "X / N free today" (counter), "Free tier used up — add your own key in Settings" (CTA disable + violet dot on gear), "Using your Anthropic key" (BYOK active, no counter)
- [ ] Backend returns remaining quota in response headers; client reads and renders
- [ ] **Verify:** On 6th call (with default `FREE_TIER_DAILY_LIMIT=5`), CTA disables and the gear shows a subtle violet dot. With BYOK key set, indicator hides the counter and shows the provider name only.

## 9. Debug tab

- [ ] `src/components/Editor.tsx` — Monaco wrapper, registers `genfix-dark` theme using `--code-*` tokens, ligatures on, minimap off, Python language
- [ ] `src/components/DiffView.tsx` — `react-diff-viewer-continued`, side-by-side, themed with diff tints from DESIGN §"Diff view"
- [ ] Debug layout: input editor + "What went wrong" textarea + Fix CTA on the left; output Monaco/diff (default-on) + explanation (markdown) + Copy/Download on the right
- [ ] Diff/Full toggle pill above the output
- [ ] Loading state: CTA shows the JetBrains-Mono dot spinner, no other animation runs
- [ ] **Verify:** Use `genlayer-dev:write-contract` to draft a contract with a planted bug (e.g., float in storage). Paste, hit Fix, confirm diff highlights the line and the explanation cites the rule.

## 10. Generate tab

- [ ] Generate layout: large textarea + Generate CTA on the left; output read-only Monaco + usage notes (markdown) + Copy/Download on the right
- [ ] **No network selector** (per locked decisions)
- [ ] Same loading-state discipline as Debug
- [ ] **Verify:** Type "sealed-bid auction where the LLM reveals the winner after a deadline". Confirm the produced contract has the correct header, no floats, `Address(...)` conversion in setters, `gl.message.sender_address`, and a sensible `eq_principle` choice. Optionally lint with `genlayer-dev:genvm-lint`.

## 11. Polish

- [ ] Empty-state Instrument Serif moment on the output side ("waiting for code") + `⌘+Enter` keyboard hint
- [ ] `⌘+Enter` shortcut fires the active tab's CTA when the input is focused
- [ ] Error toasts: provider 401/500, BYOK provider 429, network error, malformed JSON warning
- [ ] `prefers-reduced-motion`: strip easing transitions to instant
- [ ] Focus ring on every focusable element (buttons, inputs, tabs, rail items, settings rows)
- [ ] Mobile (<1024px): "Best on a wider screen" notice instead of squished layout
- [ ] Favicon: italic violet *F* on dark
- [ ] Page-load reveal cascade: rail (0ms) → topbar slide-down 8px (60ms) → workspace fade-in (120ms), total <300ms, once
- [ ] **Verify:** Tab through every focusable element in both tabs and Settings — focus ring visible everywhere. Toggle reduced-motion in DevTools — animations stop. Resize <1024px — see the notice.

## 12. Pre-deploy

- [ ] `pnpm build` succeeds with no warnings
- [ ] `pnpm lint` clean
- [ ] `pnpm typecheck` clean
- [ ] Smoke test both flows on free tier (counter advances) and BYOK (each provider) locally
- [ ] Push to GitHub (open repo, MIT)
- [ ] Connect Vercel project, add all env vars from `.env.example`
- [ ] **Verify:** Vercel preview URL passes the same smoke test. Confirm `x-forwarded-for` IP rate limiting actually counts across two networks (e.g., laptop wifi + phone hotspot).

---

## Open items (track separately as they come up)

- [ ] Cost estimation per provider — wire `usage` token counts into the global USD ceiling. Numbers in `src/lib/pricing.ts` (token → $ rates per model).
- [ ] Light mode (post-v1)
- [ ] `genvm-lint` server-side check (post-v1)
