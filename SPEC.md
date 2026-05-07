# GenForge — v1 Spec

*A debug & generate tool for GenLayer Intelligent Contracts.*

## What it is

A Next.js web app that helps GenLayer developers (1) fix broken Intelligent Contracts and (2) generate new ones from a natural-language description. The LLM does the heavy lifting. Anyone can use it via a small free daily allowance backed by a server-side key; users who want unlimited usage bring their own API key. No on-chain component in v1.

## Who it's for

Developers building on GenLayer who hit the same recurring footguns (no float in nondet, storage access inside nondet blocks, wrong eq_principle choice, address comparison casing, etc.) and want a faster loop than "deploy → fail → read traceback → guess."

## Core flows

### Flow 1 — Debug

1. User pastes a `.py` contract into the editor (or uploads a file).
2. Optionally pastes an error message / traceback / failing test description into a "what went wrong" field.
3. Clicks **Fix**.
4. App sends contract + error context + system prompt to the LLM via the user's key.
5. App renders: corrected contract on the right, side-by-side diff, and a plain-English explanation of what was wrong and what changed.
6. User can copy the fixed contract or download it as `.py`.

### Flow 2 — Generate

1. User types a natural-language description in a textarea ("a sealed-bid auction where bids are revealed by the LLM, highest bid wins after deadline").
2. Optionally selects target network (StudioNet / Bradbury) — only affects the contract header hash. *(See open question 2.)*
3. Clicks **Generate**.
4. App sends description + system prompt to the LLM.
5. App renders: contract file, short usage notes (constructor args, key methods, expected calling pattern).
6. Same copy/download options.

## Tech stack

- **Framework:** Next.js 15 (App Router) + TypeScript + Tailwind
- **Editor:** Monaco (Python syntax highlighting)
- **Diff view:** `react-diff-viewer-continued` or Monaco's built-in diff editor
- **LLM SDKs:** `@anthropic-ai/sdk`, `openai`, `@google/genai` — used both server-side (free tier) and forwarded to from BYOK requests
- **Rate-limit store:** Vercel KV or Upstash Redis (free tier) — holds per-IP daily counters with a 24-hour TTL. Tiny surface, no schema, no backups to worry about.
- **Server-side secrets:** one server LLM key in env (`SERVER_LLM_KEY` + `SERVER_LLM_PROVIDER`). Never logged. Never exposed to the client.
- **Browser-side key storage:** BYOK keys live in `localStorage` only and are sent only on the single request that uses them.

## API key handling

Two modes, picked automatically based on what the user has configured.

### Free tier (server key)

- Default for any user who hasn't added their own key.
- Backed by a single server-side LLM key in env vars. Provider chosen for cost-per-quality (recommendation: Gemini Flash or Claude Haiku — see open question 6).
- Subject to the rate limits defined in the next section.
- The user never sees the server key, never picks the provider, never picks the model. They just get a working tool.
- Available for **both Debug and Generate** in v1. We can split if costs blow up, but starting unified.

### BYOK (user key)

- User pastes their API key in a Settings panel.
- Stored in `localStorage` only. Sent to our backend only on the single request that uses it (we then forward to the provider). Never persisted server-side, never logged.
- Provider toggle: **Anthropic (Claude) / OpenAI (GPT) / Google (Gemini)**.
- Each provider has its own key slot — switching providers doesn't lose the others' keys.
- BYOK gets unlimited requests (subject to the user's own provider quota, which is their problem, not ours).
- Per-provider model selector with sensible defaults pre-selected:
  - Anthropic default: latest flagship (`claude-opus-4-7` or equivalent)
  - OpenAI default: latest flagship reasoning model
  - Gemini default: latest flagship Pro model
  - Defaults live in a small config file we update over time.
- Clear "your key is stored in your browser only" disclaimer.

### Routing logic (every request)

```
if user has BYOK key for selected provider → use BYOK path (unlimited)
elif daily server-tier quota remaining for this IP → use server path
else → return 429 with "free tier exhausted, add your own key" message
```

## Free tier & rate limiting

The whole reason the free tier exists is to let people try the tool without setup friction. The whole reason rate limiting exists is to keep the free tier from bankrupting us.

### Limits

- **Per-IP daily quota:** 5 requests / 24 hours. Counted across both Debug and Generate. Reset is rolling (TTL on the KV entry), not midnight UTC.
- **Global daily ceiling:** configurable in env (`SERVER_LLM_DAILY_REQUEST_CAP` and `SERVER_LLM_DAILY_USD_CAP`). When either cap is hit, the server tier turns off until the next day. Users see a "free tier exhausted globally — please bring your own key" message.
- **Circuit breaker:** if the server provider returns 5xx 3 times in 5 minutes, free tier auto-disables for an hour. Logged so we notice.

### Implementation notes

- Per-IP key in KV: `ratelimit:ip:<ip>:<YYYY-MM-DD>` → integer counter, 24h TTL.
- Global counters: `ratelimit:global:<YYYY-MM-DD>` → integer counter and (separately) cumulative cost estimate.
- IP detection respects `x-forwarded-for` (Vercel sets this correctly). First IP in the chain wins.
- IP rotation is trivial; we accept this as a known limitation for v1. If abuse becomes real, add fingerprinting (Cloudflare Turnstile is the leading candidate, since the GenLayer faucet already uses it and the audience won't find it weird).
- Rate-limit middleware runs *before* the LLM call. If it fails, no provider request is made.

### What the user sees

- **Has free tier remaining (no BYOK):** small "X / 5 free today" counter in the bottom-right of the workspace, in `--text-tertiary`. Quiet.
- **Free tier exhausted (no BYOK):** primary CTA disabled with tooltip "Free tier used up — add your own key in Settings for unlimited." Settings gear gets a subtle violet dot to draw attention.
- **Global ceiling hit (no BYOK):** same as above but message reads "Free tier paused for today. Add your own key for unlimited."
- **Has BYOK:** no counter shown. Just "Using your Anthropic key" (or whichever provider) text in the same bottom-right slot, also in `--text-tertiary`.

### What we log

- Per-request: timestamp, IP (hashed), tier (free / byok), provider, success/failure, token usage, latency.
- No prompt content, no response content, no API keys. Ever.
- Daily aggregate (cost, request count, error rate) emitted to whatever analytics surface we end up using (probably just console + a daily Vercel cron summary).

## Provider abstraction

A single internal interface so the rest of the app doesn't care which provider is in use:

```ts
interface LLMProvider {
  name: 'anthropic' | 'openai' | 'gemini';
  generate(opts: {
    apiKey: string;
    model: string;
    systemPrompt: string;
    userPrompt: string;
    responseFormat: 'json';
  }): Promise<{ text: string; usage?: TokenUsage }>;
}
```

Three implementations behind it. The system prompt and user prompt are provider-agnostic; per-provider quirks (Gemini's `systemInstruction` field, OpenAI's `response_format`, Anthropic's `system` parameter) are absorbed inside each adapter.

JSON mode handling:
- **Anthropic:** prompt-engineered + parse with fallback (no native strict JSON mode for arbitrary schemas)
- **OpenAI:** `response_format: { type: "json_object" }` or structured outputs if supported by the chosen model
- **Gemini:** `responseMimeType: "application/json"` + optional `responseSchema`

## System prompt design

The system prompt is the product. It bakes in everything from Part 1 of the guidelines plus the gotchas in 4.12–4.17. Single fat prompt (~6–8k tokens) on every request — simple, reliable, and the user is paying for tokens anyway.

Sections:

1. **Role** — "You are an expert GenLayer Intelligent Contract developer."
2. **GenLayer primer** — 2–3 paragraphs (what an IC is, equivalence principle, nondet blocks).
3. **Hard rules** (numbered, prescriptive):
   - Header format (`# v0.1.0` + `Depends` line with the pinned hash)
   - Storage types (`TreeMap`, `DynArray`, no float, sized ints)
   - Decorators (`@gl.public.view` / `.write` / `.write.payable`)
   - Address params as `str`, converted with `Address(...)` inside
   - `gl.message.sender_address` for caller
   - `raise gl.vm.UserError(...)` for guards
4. **Nondet patterns** — `gl.eq_principle.*` choices and when to use each, plus the storage-copy-before-nondet rule.
5. **Common bugs and their fixes** — pulled from sections 4.12–4.17 (address casing, JSON parsing, separating LLM calls from state changes, etc.).
6. **Output format** — strict JSON:
   - Debug: `{ "fixed_code": "...", "explanation": "...", "changes": [{ "what": "...", "why": "..." }] }`
   - Generate: `{ "code": "...", "usage_notes": "...", "constructor_args": [...] }`

## UI layout

Single-page app with a tab switcher at the top (Debug / Generate) and a settings gear in the corner.

**Debug tab:**

```
┌─────────────────────────────┬─────────────────────────────┐
│  Your contract              │  Fixed contract             │
│  [Monaco editor, Python]    │  [Monaco read-only or diff] │
│                             │                             │
│                             │                             │
├─────────────────────────────┤                             │
│  What went wrong (optional) │                             │
│  [textarea]                 │  Explanation                │
│                             │  [markdown rendered]        │
│  [Fix button]               │                             │
│                             │  [Copy] [Download .py]      │
└─────────────────────────────┴─────────────────────────────┘
```

**Generate tab:**

```
┌─────────────────────────────┬─────────────────────────────┐
│  Describe your contract     │  Generated contract         │
│  [large textarea]           │  [Monaco read-only]         │
│                             │                             │
│  Network: ( ) Studio        │                             │
│           (•) Bradbury      │  Usage notes                │
│                             │  [markdown rendered]        │
│  [Generate button]          │                             │
│                             │  [Copy] [Download .py]      │
└─────────────────────────────┴─────────────────────────────┘
```

**Settings modal:**

Settings is now optional — the tool works on the free tier without any setup. Settings is for users who want unlimited usage via their own key.

- Header copy explains the deal: "The free tier gives you 5 requests per day. Add your own API key for unlimited usage. Your key is stored in your browser only."
- LLM provider segmented control (Anthropic / OpenAI / Gemini)
- Per-provider API key inputs (password fields, "Save to browser" button)
- Per-provider model selector
- "Clear key" buttons (one per provider, plus "Clear all")
- Quiet "currently using: free tier / your Anthropic key / etc." indicator at the bottom of the modal so the user knows what changing settings will do.

## Error handling

- Empty input → disable button
- LLM API error (401, 500) → toast with the provider's error message, stripped of any sensitive headers
- LLM returns malformed JSON → fall back to displaying raw text with a warning, plus a "Try again" button
- Rate limit hit (429 from our backend, not the provider) → CTA disables, message points the user at Settings to add a key. No toast — the inline message is enough.
- BYOK provider returns 429 → toast: "Your provider rate-limited the request. Try again shortly or switch provider in Settings."
- Network error → generic retry prompt

## Out of scope for v1 (explicit)

- No `genvm-lint` server-side check (deferred to v2)
- No sandboxed contract execution
- No on-chain certification
- No history / saved contracts
- No accounts or auth
- No collaboration / sharing
- No usage analytics beyond basic page views (if any)

## Open questions

1. ~~**Provider scope.**~~ ✅ Resolved: Anthropic, OpenAI, and Gemini all supported for BYOK.
2. **Network selector in Generate tab — actually useful?** The only network-specific thing is the `Depends` hash, which is the same on both per section 4.2. The selector is cosmetic. **TBD: keep, drop, or replace with something else.**
3. **Diff view default-on or default-off?** Default-on is more informative for debugging but uses more screen. Lean default-on with a toggle. **TBD: confirm.**
4. **Hash pinning for the `Depends` line.** Spec hardcodes `1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`. When this hash changes, every generated contract becomes outdated. **TBD: small server-side config file, env var, or inline in the prompt?**
5. **License / branding.** Solo project under your handle, or "for the community" with MIT license and an open repo? **TBD.**
6. **Server-tier provider.** Pick one of Anthropic Haiku / Gemini Flash / OpenAI mini-tier as the server key. Cheapest-with-acceptable-quality wins. **TBD: pick after a brief eval against a handful of broken contracts.**
7. **Free tier limit number.** Spec says 5/day per IP. Could be 3, could be 10. Depends on average cost per request and how viral we expect this to go. **TBD: revisit after the eval in (6).**
8. ~~**App name.**~~ ✅ Resolved: **GenForge**.

## Build sequence (when we move to implementation)

1. System prompt (the product) — write it, eyeball-test it against 5–10 broken contracts and 5–10 generation prompts.
2. Provider adapters (Anthropic, OpenAI, Gemini). Same interface used by both server-tier and BYOK paths.
3. Backend route + KV-backed rate limiter + circuit breaker + cost cap.
4. Settings panel + key storage.
5. Free-tier UI states (counter, exhausted message, BYOK indicator).
6. Debug tab.
7. Generate tab.
8. Polish: diff toggle, download, error states.

---

*Spec version 2 — added hybrid free tier (server key + BYOK) and rate limiting. Update as questions resolve.*
