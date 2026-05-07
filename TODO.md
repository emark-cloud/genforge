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
- [ ] `git init`, first commit
- [ ] **Verify:** `pnpm dev` boots a blank app on `http://localhost:3000` without errors.

## 2. Design tokens & fonts

- [ ] `src/styles/globals.css` — full token set from `DESIGN.md`: colors, radii, spacing, type scale, focus ring
- [ ] `tailwind.config.ts` — map utilities (`bg-canvas`, `text-secondary`, `radius-pill`, etc.) to vars
- [ ] Load Geist, Instrument Serif, JetBrains Mono via `next/font` in `app/layout.tsx`
- [ ] Set `<html>` to `--bg-canvas`, `--text-primary`, `--font-ui` defaults
- [ ] **Verify:** Drop a `<button>` and `<input>` on the page; confirm colors, focus ring, fonts. No FOUT. No hex literals in any component.

## 3. System prompt

- [ ] `src/lib/genlayer-version.ts` — export the pinned `Depends` hash
- [ ] `src/lib/system-prompt.ts` — role + GenLayer primer + hard rules + nondet patterns + common bugs (§4.12–4.18) + per-flow JSON schemas (`debug` / `generate`)
- [ ] Scratch script `scripts/eval-prompt.ts` — feeds 5 broken contracts (each with one of: float in storage, missing `@allow_storage`, address `==` comparison, storage access in nondet, JSON parse w/o fence-strip) and 5 generation prompts (auction, vote, escrow, content moderator, web fetcher) to Gemini, prints JSON
- [ ] **Verify:** All 10 outputs return well-formed JSON. Debug fixes mention the actual rule. Generated contracts have correct header, no floats, decorated address-to-`Address`-conversion, `gl.message.sender_address` for sender.

## 4. Provider adapters

- [ ] `src/lib/providers/types.ts` — `LLMProvider` interface from SPEC §"Provider abstraction"
- [ ] `src/lib/providers/gemini.ts` — uses `responseMimeType: "application/json"` + optional `responseSchema`
- [ ] `src/lib/providers/anthropic.ts` — prompt-engineered JSON, robust fence-strip parser fallback
- [ ] `src/lib/providers/openai.ts` — `response_format: { type: "json_object" }` (or structured outputs if model supports)
- [ ] `src/lib/providers/index.ts` — factory `getProvider(name)`
- [ ] `src/lib/models.ts` — current per-provider default model IDs (latest flagship for BYOK; Gemini Flash for server)
- [ ] **Verify:** One scratch call per provider returns the expected shape. Errors include status code + provider message stripped of headers.

## 5. Rate limit + circuit breaker + global caps

- [ ] `src/lib/rate-limit.ts` — Upstash REST client; per-IP daily fixed window (`ratelimit:ip:<hash>:<YYYY-MM-DD>`, 24h TTL); global counters (`ratelimit:global:<YYYY-MM-DD>` for count and USD est)
- [ ] `src/lib/circuit.ts` — Upstash-backed counter; 3× 5xx in 5 min → open for 1h
- [ ] `src/lib/ip.ts` — first-hop `x-forwarded-for`, fallback `request.ip`
- [ ] `src/lib/log.ts` — structured logger that *cannot* take prompt/response/key as args (type-level guard)
- [ ] **Verify:** With `FREE_TIER_DAILY_LIMIT=2`, curl the route 3× — 3rd is 429. Confirm key TTL via Upstash console. Mock provider 5xx three times → next call returns 503 with breaker message.

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
