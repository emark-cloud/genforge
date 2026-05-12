# genforge-lint

Tiny HTTPS microservice that wraps `genvm-lint check --json` so GenForge can lint user contracts and model output before/after the LLM call. Deployed to Fly.io; intended to be the only network dependency `/api/debug` and `/api/generate` add beyond their LLM provider.

### What this catches

`check` runs both subcommands: the **lint** pass surfaces AST-level warnings (missing header, etc.) and the **validate** pass surfaces SDK-level errors (missing `__init__`, illegal storage primitives, decorator misuse, etc.).

Validate shells out to pyright, which cold-starts in ~40s on Docker's overlayfs. The Dockerfile dodges that by running `genvm-lint validate` once at build time on a trivial contract so pyright's binary caches are baked into the image. Warm `check` lands at ~1.7s. If a `RUN ... validate` step ever fails at build, the image still publishes but request latency will revert to the cold path until the first /lint request warms it.

## Endpoints

- `POST /lint` — `{ "contract": "<python source>" }` → `{ ok, errors[], warnings[], raw }`. Requires header `X-Lint-Secret: <shared secret>`.
- `GET /healthz` — liveness probe.

Body cap 64 KiB, lint timeout 8s, raw output truncated to 4 KiB, issue arrays capped at 50.

## Local run

```bash
docker build -t genforge-lint lint-service/
docker run --rm -p 8080:8080 -e LINT_SECRET=dev genforge-lint
curl -sf -X POST localhost:8080/lint \
  -H 'content-type: application/json' \
  -H 'X-Lint-Secret: dev' \
  -d '{"contract":"x = 1.0\n"}'
```

## Deploy to Fly.io

First time:

```bash
cd lint-service
fly launch --no-deploy --copy-config         # accepts fly.toml
fly secrets set LINT_SECRET=$(openssl rand -hex 32)
fly deploy
```

Subsequent deploys:

```bash
cd lint-service
fly deploy
```

Note the deployed URL (e.g. `https://genforge-lint.fly.dev`) and the secret. Set both in Vercel as `LINT_SERVICE_URL` and `LINT_SERVICE_SECRET`, and in `.env.local` for dev.

## Rotating the secret

```bash
NEW=$(openssl rand -hex 32)
fly secrets set LINT_SECRET=$NEW         # service restarts on the new value
# then update Vercel env + .env.local with the same value
```

GenForge's lint client fails open — if the secrets drift, the API routes will still return the LLM result with no `lint` field while you rotate.

## Why a separate service

Vercel serverless functions are Node-only; `genvm-lint` is a Python CLI bundled with a sizable wheel + SDK cache. Running it on a long-lived Fly machine keeps the GenForge function bundle small and the linter warm, at the cost of one network hop (~50–150ms typical).
