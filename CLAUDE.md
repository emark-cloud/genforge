# GenForge — Claude Project Guide

A debug & generate tool for GenLayer Intelligent Contracts. This file is loaded automatically into every Claude session in this directory; keep it terse and accurate.

## What this is

A Next.js 15 web app with two flows:

- **Debug** — paste a broken `.py` Intelligent Contract (+ optional error context), get a fixed contract, side-by-side diff, and a plain-English explanation.
- **Generate** — type a natural-language description, get a working contract + usage notes.

The LLM does the heavy lifting. Anyone can use it via a free server-side tier (rate-limited per IP); users can paste their own API key for unlimited usage.

**No on-chain component in v1.** No accounts, no history, no execution sandbox.

Source-of-truth docs (read before changing scope):
- `SPEC.md` — functional spec
- `DESIGN.md` — visual + interaction design language
- `GUIDELINES.md` — GenLayer contract patterns the system prompt teaches

## Tech stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript strict, Tailwind 4
  - Bootstrap installed Next 16, not 15 — see `AGENTS.md` and `node_modules/next/dist/docs/` before assuming familiarity. Some APIs and conventions differ from Next 15.
- **Toolchain:** pnpm + Node 20 LTS
- **Editor:** Monaco (custom `genfix-dark` theme, JetBrains Mono, ligatures on)
- **Diff:** `react-diff-viewer-continued`, side-by-side
- **Icons:** `lucide-react`
- **LLM SDKs:** `@anthropic-ai/sdk`, `openai`, `@google/genai`
- **Rate-limit store:** Upstash Redis (`@upstash/redis` + `@upstash/ratelimit`)
- **Deploy target:** Vercel

## Architecture

```
app/
  layout.tsx          ← fonts, theme, global CSS vars
  page.tsx            ← single-page workspace (rail + topbar + tabs)
  api/
    debug/route.ts    ← POST: contract + error → fix
    generate/route.ts ← POST: description → contract

src/
  components/         ← Topbar, Rail, Tabs, Editor, DiffView, SettingsModal, ...
  lib/
    providers/        ← anthropic.ts, openai.ts, gemini.ts, index.ts (factory)
    rate-limit.ts     ← Upstash IP + global counters + USD est
    circuit.ts        ← 5xx breaker for the free-tier provider
    system-prompt.ts  ← THE PRODUCT — fat shared prompt + per-flow JSON schemas
    genlayer-version.ts ← pinned py-genlayer Depends hash
    models.ts         ← per-provider default models
    keys.ts           ← BYOK localStorage helpers (SSR-safe)
  styles/globals.css  ← color/spacing/type tokens (DESIGN.md → CSS vars)
```

### Request routing (every `/api/debug` and `/api/generate` call)

```
1. Parse body → { contract|description, errorContext?, byok?: {provider, key, model} }
2. If BYOK key present → use providers[byok.provider].generate({ apiKey: byok.key, ... }) (unlimited).
3. Else (free tier):
   a. Circuit breaker check → if open, 503.
   b. Global daily caps (req count + USD est) → if exceeded, 429.
   c. Per-IP daily limit → if exceeded, 429.
   d. Increment counters, then call Gemini Flash with SERVER_LLM_KEY.
   e. On 5xx → record breaker failure.
4. Parse JSON output (strip markdown fences first — see GUIDELINES §4.14).
5. Log: timestamp, hashed-IP, tier, provider, success, tokens, latency. NEVER prompt/response/key.
6. Return JSON to client.
```

IP detection: first hop of `x-forwarded-for` (Vercel-correct). Hash with sha256 + `IP_HASH_SALT` before logging.

## Hard rules for this codebase

1. **The system prompt is the product.** It bakes in everything from `GUIDELINES.md` Part 1 + §4.12–4.18. Treat changes to `src/lib/system-prompt.ts` like API changes — eyeball-test against a handful of broken contracts and generation prompts before merging.
2. **No hex literals in components.** All colors, radii, spacing, type sizes, and motion timings come from CSS variables defined in `globals.css`. If you need a value that isn't there, add a token first.
3. **Violet is for one thing per surface.** Primary CTA, or active tab, or focus state — never two simultaneously. See DESIGN.md "Accent rule".
4. **Never log prompts, responses, or API keys.** Token counts and latency only. Per-IP analytics use a hashed IP.
5. **BYOK keys live in `localStorage` only.** Sent to our backend only on the single request that uses them. Never persisted server-side.
6. **Pinned `Depends` hash lives in one place** (`src/lib/genlayer-version.ts`) and is imported by `system-prompt.ts`. Update it there when py-genlayer pins a new release.
7. **No bouncy easing, no springs.** Motion is 120–180ms ease-out. Async actions get a single dedicated animation (the CTA spinner) and nothing else moves while it spins.
8. **Mobile is out of scope.** Below 1024px, show "best on a wider screen" — don't try to reflow the three-zone layout.

## Common commands

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm build
pnpm lint
pnpm typecheck    # tsc --noEmit
```

## Required env vars

See `.env.example`. Summary:

| Var | Purpose |
|---|---|
| `SERVER_LLM_KEY` | Server-side Gemini key for the free tier. Never logged, never exposed to the client. |
| `SERVER_LLM_PROVIDER` | `gemini` (locked for v1; field exists so we can swap later). |
| `SERVER_LLM_MODEL` | e.g. `gemini-2.5-flash`. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Rate-limit store. |
| `FREE_TIER_DAILY_LIMIT` | Per-IP daily request cap. Default `5`. |
| `SERVER_LLM_DAILY_REQUEST_CAP` | Global daily request ceiling for the free tier. |
| `SERVER_LLM_DAILY_USD_CAP` | Global daily USD ceiling for the free tier. |
| `IP_HASH_SALT` | Salt for sha256 hashing IPs in logs. |

## Out of scope for v1 (do not add without discussion)

- `genvm-lint` server-side check (deferred to v2)
- Sandboxed contract execution
- On-chain certification
- Saved history, accounts, auth, sharing
- Light mode (dark-only by design; light mode would need re-deriving the palette)
- Anything mobile beyond the wider-screen notice

## Available skills (relevant ones)

- `genlayer-dev:write-contract` — for drafting test contracts to validate the Debug flow
- `genlayer-dev:genvm-lint` — for verifying generated contracts in dev (not in the app)
- `genlayer-dev:direct-tests` / `genlayer-dev:integration-tests` — only if we ever wire test harnesses

## Pointer

Build sequence and per-step verification live in `TODO.md`. Open questions resolved during planning are recorded at the top of the plan file: `/home/emark/.claude/plans/go-through-the-files-joyful-flame.md`.
