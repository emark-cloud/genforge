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

- [x] `src/lib/run-llm.ts` — single brain shared by both routes: validates body (size in UTF-8 bytes, BYOK shape), branches on BYOK vs free-tier, walks the breaker → caps → per-IP ladder, calls the chosen provider, parses JSON with fence-strip fallback (`{warning, raw}` when the model produces non-JSON), logs `llm_success` / `llm_failure` / `rate_limit_block` / `circuit_block` / `circuit_open`, returns `{status, body, headers}` with `x-genforge-tier` + `x-ratelimit-*` headers.
- [x] `src/app/api/debug/route.ts` — `POST` only; catches malformed-JSON body → 400 before calling `runLLM("debug", ...)`. `runtime = "nodejs"`, `dynamic = "force-dynamic"`.
- [x] `src/app/api/generate/route.ts` — same pattern for the generate flow.
- [x] Validation: empty/whitespace required field → 400; >64KB contract / >8KB description → 413; non-JSON body → 400. UTF-8 byte length is what's measured, not `.length`.
- [x] **Verify:** `scripts/check-routes.ts` against the running dev server — all 18 assertions pass: malformed JSON → 400 with error, missing/whitespace required → 400 (both flows), 65KB contract → 413, debug+generate happy paths return 200 with the expected schema (`fixed_code`/`explanation`/`changes[]` and `code`/`usage_notes`/`constructor_args[]`), `x-genforge-tier=free` + `x-ratelimit-limit=5` + decreasing `x-ratelimit-remaining` across calls. Separately verified `_exhaust.ts` — pre-setting the IP counter to the cap produces `status=429, body.reason="per_ip", error="You've used today's free requests. Add your own key in Settings to continue."`. `pnpm typecheck` clean.

## 7. Settings modal + BYOK key storage

- [x] `src/lib/keys.ts` — SSR-safe `localStorage` wrapper (`getKey` / `setKey` / `clearKey` / `clearAll` / `getModel` / `setModel` / `getCurrentProvider` / `setCurrentProvider` / `getActiveByok`). First key saved becomes "current" automatically; clearing the current key drops the pointer; unknown model ids rejected.
- [x] `src/components/SettingsModal.tsx` — segmented Anthropic / OpenAI / Gemini tabs (each shows a dot when a key is saved, violet when active), password input with reveal toggle, per-provider model `<select>`, "Use this provider" action with an "Active" pill when selected, per-provider "Clear" + footer "Clear all", quiet "Currently using your X key (model)" footer that falls back to "Free tier — using GenForge's server key." Disclaimer: "Your key is stored in your browser only — it's sent to GenForge on the single request that uses it and never saved server-side."
- [x] `Esc` closes; `Tab` / `Shift+Tab` cycles only within the dialog (focus trap); focus restored to the launcher on close. Modal is mounted only while open (`{open && <SettingsModal/>}`) so initial state hydrates from `localStorage` via lazy `useState` — no set-state-in-effect.
- [x] Temporary `src/components/SettingsLauncher.tsx` button wired into `src/app/page.tsx`; the real topbar gear lands in Step 9.
- [x] **Verify:** `scripts/check-keys.ts` — 36 assertions against a `Map`-backed `localStorage` mock all pass: starts empty, first-key-saved promotes that provider to current, second key doesn't override current, `setCurrentProvider` rejects providers without a saved key, model selection persists + unknown models rejected, module re-import (= page reload) preserves everything, `clearKey` drops the pointer iff it was the current one, `clearAll` empties storage including the model overrides. `pnpm build` + `pnpm typecheck` + `pnpm lint` clean.

## 8. Free-tier UI states

- [x] `src/lib/quota.ts` — `tierFromHeaders` + `readQuotaHeaders` that turn a `fetch` response into the indicator's input. BYOK responses (no ratelimit headers) → `null` quota.
- [x] `src/hooks/useByok.ts` — `useSyncExternalStore`-backed subscription to `localStorage` + a `genforge:byok-changed` window event dispatched by `SettingsModal` on every change. Snapshot is cached by `provider|key|model` so React doesn't infinite-loop. Also listens for cross-tab `storage` events.
- [x] `src/components/FreeTierIndicator.tsx` — three states: BYOK active (key icon + "Using your X key"), exhausted (alert icon + "Free tier used up — add your own key in Settings"), free (sparkle + "{remaining} / {limit} free today" or quieter "Free tier" before the first call). Exported `isExhausted(byok, quota)` predicate for CTA disable logic.
- [x] `SettingsLauncher` gained a `pulse` prop that paints a 6px violet dot on the gear when free tier is exhausted and no BYOK is set.
- [x] `FreeTierSmoke` harness on the smoke-test page so the three states + dot + disabled CTA can be eyeballed in `pnpm dev` until the real workspace lands in Step 9.
- [x] **Verify:** `scripts/check-quota.ts` — 14 assertions: `tierFromHeaders` maps `free` / `byok` / `n/a` / missing correctly; `readQuotaHeaders` parses headers, clamps negative `remaining` to 0, rejects non-numeric, returns null for BYOK; `isExhausted` is false for `null` quota / available / BYOK, true only for `remaining<=0 && !byok`. Combined with the Step 6 route tests that already prove the API emits `x-genforge-tier` + `x-ratelimit-*`, the data path is end-to-end-verified. `pnpm build` + `pnpm typecheck` + `pnpm lint` clean.

## 9. Debug tab

- [x] `src/components/Editor.tsx` — Monaco wrapper. `beforeMount` registers `genfix-dark`, reading the `--code-*` / `--bg-*` / `--text-*` / `--accent` palette from `:root` computed styles (so the editor tracks `globals.css` rather than duplicating hex literals). Ligatures on, minimap off, line-highlight `--bg-card-hover`, cursor + selection `--accent`, scrollbar 8px with `--border-*` thumbs, no context menu, Python language preset.
- [x] `src/components/DiffView.tsx` — `react-diff-viewer-continued`, side-by-side, dark theme. All chrome routed through CSS vars including the new `--diff-removed-bg` / `--diff-removed-strong` / `--diff-added-bg` / `--diff-added-strong` tints declared in `globals.css` (per DESIGN §"Diff view").
- [x] `src/components/Spinner.tsx` — JetBrains-Mono six-dot cycle at 80ms per frame; consumed by the CTA loading state and nothing else, per DESIGN motion rule 2.
- [x] `src/components/Markdown.tsx` — `react-markdown` wrapper with tailored styles (paragraphs, bullets, inline code in `--accent-bg-subtle`, links in `--accent`, headings demoted to label-caps for `h3+`).
- [x] `src/components/CopyButton.tsx` + `DownloadButton.tsx` — secondary-style chips. Copy briefly switches to a green check; Download writes a `text/x-python` Blob and clicks an anchor.
- [x] `src/components/Tabs.tsx` — Debug / Generate switcher with the animated 2px violet underline (180ms ease-out from `scaleX(0)` to `scaleX(1)`, per DESIGN §Tabs).
- [x] `src/components/Topbar.tsx` — 56px bar: italic-serif wordmark left, tabs centered, `FreeTierIndicator` + `SettingsLauncher` (with the pulsing violet dot when exhausted) right.
- [x] `src/components/DebugTab.tsx` — left column: contract editor + char counter + "What went wrong" textarea + Fix CTA + inline error banner; right column: `EmptyOutput` ("waiting for code" in display serif) until a result lands, then `DebugOutput`. ⌘/Ctrl+Enter fires the CTA from inside either input. The contract value at submit time is stashed so editing the input after firing doesn't shift the diff.
- [x] `src/components/DebugOutput.tsx` — diff/full pill toggle (Diff is default-on), Copy + Download right-aligned, then the diff or read-only Monaco beneath, then a card with markdown explanation + per-change `what/why` cards.
- [x] `src/components/EmptyOutput.tsx` — the "waiting for code" serif moment.
- [x] `src/components/GenerateTab.tsx` — placeholder until Step 10.
- [x] `src/components/Workspace.tsx` — shell that owns `activeTab` + `quota` + the `useByok` subscription; below 1024px renders the "best on a wider screen" notice instead of the workspace (CLAUDE.md rule #8).
- [x] `src/app/page.tsx` rewritten to `<Workspace />`; the Step-2 token smoke page is gone.
- [x] **Verify:** `pnpm build` + `pnpm typecheck` + `pnpm lint` clean. The new UI only consumes the `/api/debug` JSON shape that `scripts/check-routes.ts` (Step 6) already exercised end-to-end against the real Gemini + real Upstash. Interactive eyeball test (paste a bad contract → Fix → confirm diff + explanation) is a user-side check in `pnpm dev`.

## 10. Generate tab

- [x] `src/components/GenerateTab.tsx` — left column: full-height description textarea + char counter + Generate CTA + inline error banner; right column: `EmptyOutput` until a result lands, then `GenerateOutput`. ⌘/Ctrl+Enter fires from inside the textarea. `isExhausted` gates the CTA the same way DebugTab does.
- [x] `src/components/GenerateOutput.tsx` — Copy + Download right-aligned above a read-only Monaco of the produced contract, then a card with markdown usage notes + per-arg `name: type` / description cards.
- [x] `Workspace.tsx` updated to thread `byok` / `quota` / `onQuotaUpdate` into GenerateTab so the same free-tier counter and BYOK indicator govern both flows.
- [x] **No network selector** (per locked decisions).
- [x] Same loading-state discipline as Debug — single Spinner inside the CTA, nothing else moves.
- [x] **Verify:** `pnpm build` + `pnpm typecheck` + `pnpm lint` clean. The new tab only consumes the `/api/generate` JSON shape that `scripts/check-routes.ts` (Step 6) already exercised end-to-end. Interactive eyeball test (sealed-bid auction prompt → confirm header, no floats, `gl.message.sender_address`, sensible `eq_principle`) is a user-side check in `pnpm dev`.

## 11. Polish

- [x] Empty-state Instrument Serif moment on the output side ("waiting for code") + `⌘+Enter` keyboard hint (`EmptyOutput.tsx` + DebugTab/GenerateTab CTA hint).
- [x] `⌘+Enter` shortcut fires the active tab's CTA when the input is focused (handled in both `DebugTab.tsx` and `GenerateTab.tsx` via `onKeyDown` on the input column).
- [x] Inline error banner shown beneath the CTA — covers provider 401/500, BYOK provider 429, network error, malformed-JSON warning. Stayed inline (vs. toast) because it lives next to the trigger and survives until the user retries; same `role="alert"` + `--error` token in both tabs.
- [x] `prefers-reduced-motion` — `@media (prefers-reduced-motion: reduce)` in `globals.css` zeroes out every transition + animation universally.
- [x] Focus ring on every focusable element — universal `*:focus-visible` rule in `globals.css` paints the double-ring + glow. Grep confirmed no `outline-none` / `focus:outline` overrides anywhere in `src/components`.
- [x] Mobile (<1024px): "Best on a wider screen" notice instead of the squished layout (`Workspace.tsx` `matchMedia('(max-width: 1023px)')` branch — shipped in Step 9).
- [x] Favicon: italic violet *F* on dark — `src/app/icon.svg`, replaces the default `favicon.ico`. Next 16 picks up `icon.svg` automatically and emits the correct `<link rel="icon">`.
- [x] Page-load reveal cascade — `topbar-in` keyframe (slide down 8px, 180ms, 60ms delay) + `workspace-in` keyframe (fade, 180ms, 120ms delay) in `globals.css`, applied as `.reveal-topbar` on the Topbar `<header>` and `.reveal-workspace` on the workspace `<main>`. Total <300ms. Reduced-motion media query already strips it.
- [x] **Verify:** `pnpm build` + `pnpm typecheck` + `pnpm lint` clean. Reveal animations + favicon land in the production bundle (build log shows `/icon.svg` route). Focus-ring + reduced-motion tab-through is a user-side check in `pnpm dev`.

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
