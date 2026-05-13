# genforge-lint

Tiny HTTPS microservice that wraps `genvm-lint check --json` so GenForge can lint user contracts and model output before/after the LLM call. Deployed to Railway in production (a `fly.toml` ships in the repo for Fly.io as an alternative); intended to be the only network dependency `/api/debug` and `/api/generate` add beyond their LLM provider.

### What this catches

`check` runs both subcommands: the **lint** pass surfaces AST-level warnings (missing header, etc.) and the **validate** pass surfaces SDK-level errors (missing `__init__`, illegal storage primitives, decorator misuse, etc.).

Validate shells out to pyright, which cold-starts in ~40s on Docker's overlayfs. The Dockerfile dodges that by running `genvm-lint validate` once at build time on a trivial contract so pyright's binary caches are baked into the image. Warm `check` lands at ~1.7s. If a `RUN ... validate` step ever fails at build, the image still publishes but request latency will revert to the cold path until the first /lint request warms it.

## Endpoints

- `POST /lint` — `{ "contract": "<python source>" }` → `{ ok, errors[], warnings[], raw }`. Requires header `X-Lint-Secret: <shared secret>`.
- `GET /healthz` — liveness probe.

Body cap 64 KiB, lint timeout 12s, raw output truncated to 4 KiB, issue arrays capped at 50.

`/lint` serializes the subprocess call via an in-process semaphore (`LINT_CONCURRENCY`, default `2`; we run `4` on Railway) and fails fast as `503` if a slot doesn't free up within `LINT_QUEUE_WAIT_S` (default 4s). Set roughly equal to vCPU count. On Fly, also bump `http_service.concurrency` in `fly.toml` so machine-level autoscaling matches; Railway has no equivalent — pick the value once and rely on the in-process queue.

## Local run

```bash
docker build -t genforge-lint lint-service/
docker run --rm -p 8080:8080 -e LINT_SECRET=dev genforge-lint
curl -sf -X POST localhost:8080/lint \
  -H 'content-type: application/json' \
  -H 'X-Lint-Secret: dev' \
  -d '{"contract":"x = 1.0\n"}'
```

## Deploy to Railway

The service is a Dockerfile and a 230-line FastAPI app — any Docker-friendly host works (Railway, Fly.io, Render, plain VPS). These steps cover Railway, which is what production runs.

1. **New project** → https://railway.com/new → connect the GitHub repo. Scope Railway's GitHub app to just this repo.
2. **Settings → Source → Root Directory:** `lint-service`. Without this Railway builds the Next.js app at repo root by mistake.
3. **Settings → Build → Builder:** Dockerfile (auto-detected once root directory is set).
4. **Settings → Build → Watch Paths:** `lint-service/**` so Next.js edits don't trigger rebuilds.
5. **Settings → Deploy → Region:** match the GenForge Vercel region. `us-east` is the safe default (Vercel functions land in `iad1`).
6. **Settings → Deploy → Healthcheck Path:** `/healthz`. Restart Policy: `On Failure`. Together these give the Fly-equivalent of `[checks]` driven auto-restart.
7. **Variables** (only these four — anything else is GenForge config and belongs on Vercel, not here):
   - `LINT_SECRET` — `openssl rand -hex 32`. Same value goes in Vercel as `LINT_SERVICE_SECRET`.
   - `LINT_CONCURRENCY` — `4` on Railway Hobby; tune to vCPU count on other plans.
   - `LINT_QUEUE_WAIT_S` — `4`.
   - `LINT_TIMEOUT_S` — `12`.
8. **Settings → Networking → Generate Domain** → enter port **`8080`**. The Dockerfile binds 8080; Railway's edge terminates TLS and routes to it.
9. Wait for green deploy. Smoke test: `curl https://<your>.up.railway.app/healthz` → `{"ok":true}`.
10. Set `LINT_SERVICE_URL` (the bare https URL, no trailing slash, no surrounding quotes) and `LINT_SERVICE_SECRET` on Vercel — and in `.env.local` for dev.

## Deploy to Fly.io (alternative)

The repo ships a tuned `fly.toml` for Fly. First time:

```bash
cd lint-service
fly launch --no-deploy --copy-config         # accepts fly.toml
fly secrets set LINT_SECRET=$(openssl rand -hex 32)
fly deploy
```

Subsequent deploys: `cd lint-service && fly deploy`.

Fly gives machine-level autoscaling on concurrency (the `[http_service.concurrency]` block) and healthcheck-driven restarts out of the box; Railway gives an easier UI and is what production currently uses.

## Rotating the secret

Railway → Variables → `LINT_SECRET` → edit value → save (auto-redeploys). On Fly, `fly secrets set LINT_SECRET=$NEW`. Either way, update `LINT_SERVICE_SECRET` on Vercel + your local `.env.local` to match.

GenForge's lint client fails open — if the secrets drift, the API routes will still return the LLM result with no `lint` field while you rotate.

## Why a separate service

Vercel serverless functions are Node-only; `genvm-lint` is a Python CLI bundled with a sizable wheel + SDK cache. Running it on a long-lived Railway container (or Fly machine) keeps the GenForge function bundle small and the linter warm, at the cost of one network hop (~50–150ms typical).
