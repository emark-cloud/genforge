# GenForge

A debug & generate tool for [GenLayer](https://genlayer.com) Intelligent Contracts.

Paste a broken `.py` contract → get a fix, side-by-side diff, and a plain-English explanation.
Type a description → get a working contract + usage notes.

The LLM does the heavy lifting. A small free server-side tier is rate-limited per IP; users who want unlimited usage paste their own API key (Anthropic, OpenAI, or Gemini) directly into the browser.

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4
- Monaco editor · `react-diff-viewer-continued`
- `@anthropic-ai/sdk` · `openai` · `@google/genai`
- Upstash Redis for rate-limit + circuit-breaker state
- Deploys to Vercel

## Run locally

```bash
pnpm install
cp .env.example .env.local   # then fill in keys
pnpm dev                     # http://localhost:3000
```

## Required env vars

See [`.env.example`](./.env.example) for the full list with comments. Minimum to boot the free tier:

- `SERVER_LLM_KEY` — server-side Gemini key
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
- `IP_HASH_SALT` — `openssl rand -hex 32`

BYOK requests don't touch the server key or KV — they go straight from the browser through our `/api/*` route to the user's chosen provider, then back.

## Project layout

```
app/                   ← Next.js App Router (pages + API routes)
src/
  components/          ← UI: Topbar, Rail, Tabs, Editor, DiffView, ...
  lib/
    providers/         ← anthropic.ts, openai.ts, gemini.ts
    system-prompt.ts   ← the fat shared system prompt — *the product*
    rate-limit.ts      ← Upstash IP + global counters
    circuit.ts         ← 5xx breaker for the free-tier provider
    keys.ts            ← BYOK localStorage helpers
  styles/globals.css   ← design tokens (colors, type, spacing)
SPEC.md                ← functional spec
DESIGN.md              ← visual + interaction language
GUIDELINES.md          ← GenLayer contract patterns the prompt teaches
CLAUDE.md / TODO.md    ← project guide + build sequence
```

## Scripts

```bash
pnpm dev          # start dev server
pnpm build        # production build
pnpm start        # serve the production build
pnpm lint         # ESLint
pnpm typecheck    # tsc --noEmit
```

## License

MIT — see [`LICENSE`](./LICENSE).
