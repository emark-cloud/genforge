"""GenForge lint microservice — wraps `genvm-lint check --json`.

Single endpoint: POST /lint  { "contract": "<python source>" }
Returns the normalized shape consumed by src/lib/lint.ts.

`check` runs both the AST lint pass (W-codes: missing header, etc.) and
the SDK validate pass (E-codes: missing __init__, illegal storage types,
etc.). Cold-starts on the validate side (pyright) are ~40s on overlayfs,
which is why the Dockerfile runs `genvm-lint validate` once at build
time to bake the pyright caches into the image. Warm `check` is ~1.7s.

Auth: shared secret via the X-Lint-Secret header. Reject otherwise.
Logging: status only — never the source, never the secret.
"""

import asyncio
import json
import logging
import os
import subprocess
import tempfile
import threading
import time
from contextlib import asynccontextmanager, contextmanager

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

LINT_SECRET = os.environ.get("LINT_SECRET", "")
MAX_BODY_BYTES = 64 * 1024
MAX_RAW_BYTES = 4 * 1024
MAX_ISSUES = 50
# Server-side timeout. genvm-lint cold-starts at ~7s (pyright + SDK load)
# and warms to ~1.7–3s. Default 12s gives ~4× warm headroom for tail
# latency on larger contracts (E025/E026 call-graph analysis grows with
# method count) and absorbs cold paths when the warmup thread hasn't
# completed before the first request. The GenForge client's per-request
# timeout (LINT_TIMEOUT_MS) should be set ≥ this value plus a small
# network slack (~1s), so the client waits long enough to receive either
# a real result or a clean 504 from us rather than aborting first.
LINT_TIMEOUT_S = float(os.environ.get("LINT_TIMEOUT_S", "12"))
GENVM_LINT_BIN = os.environ.get("GENVM_LINT_BIN", "genvm-lint")

# In-process subprocess concurrency cap. Each /lint call shells out a
# CPU-bound `genvm-lint check` (~1.7–3s warm). On shared-cpu-1x there's
# only one vCPU, so N concurrent subprocesses each take roughly N×
# longer and quickly blow past LINT_TIMEOUT_S. The semaphore serializes
# the heavyweight call without serializing the rest of the handler
# (auth, body parsing, response shaping all stay free). Pair this with
# fly.toml's http_service.concurrency.soft_limit so Fly autoscales when
# the in-process queue starts filling instead of piling onto one box.
LINT_CONCURRENCY = int(os.environ.get("LINT_CONCURRENCY", "2"))
# How long to wait for a semaphore slot before failing fast as 503.
# Without this, queued requests could outlive their callers indefinitely
# and clog the queue with abandoned work. Default 4s — enough to ride
# out a single in-flight subprocess on a warm path; beyond that, the
# correct signal is "we're saturated, retry."
LINT_QUEUE_WAIT_S = float(os.environ.get("LINT_QUEUE_WAIT_S", "4"))

# Lazy-initialized so the semaphore binds to whichever event loop uvicorn
# ends up running (avoids the "no current event loop" trap on import).
_subprocess_sem: asyncio.Semaphore | None = None


def _get_sem() -> asyncio.Semaphore:
    global _subprocess_sem
    if _subprocess_sem is None:
        _subprocess_sem = asyncio.Semaphore(LINT_CONCURRENCY)
    return _subprocess_sem

WARMUP_SOURCE = '''# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *

class _Warmup(gl.Contract):
    n: u256
    def __init__(self):
        self.n = u256(0)
'''

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("lint")


def _warmup() -> None:
    # Pre-warm pyright + the SDK so the first real request doesn't eat a
    # 7s cold start. Best-effort; failures aren't fatal.
    f = None
    try:
        f = tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8")
        f.write(WARMUP_SOURCE)
        f.flush()
        f.close()
        t0 = time.monotonic()
        subprocess.run(
            [GENVM_LINT_BIN, "check", f.name, "--json"],
            capture_output=True, text=True, timeout=30,
        )
        log.info("warmup completed in %dms", int((time.monotonic() - t0) * 1000))
    except Exception as e:
        log.warning("warmup failed: %s", e)
    finally:
        if f is not None:
            try:
                os.unlink(f.name)
            except OSError:
                pass


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Fire-and-forget so uvicorn binds the port immediately.
    threading.Thread(target=_warmup, daemon=True, name="warmup").start()
    yield


app = FastAPI(title="genforge-lint", version="1.0.0", lifespan=lifespan)


@contextmanager
def temp_contract(source: str):
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8")
    try:
        f.write(source)
        f.flush()
        f.close()
        yield f.name
    finally:
        try:
            os.unlink(f.name)
        except OSError:
            pass


def _shape_issue(item: dict) -> dict:
    out = {"message": str(item.get("msg", "")), "line": int(item.get("line", 0))}
    if item.get("col") is not None:
        out["col"] = int(item["col"])
    if item.get("code") is not None:
        out["code"] = str(item["code"])
    return out


def normalize(parsed: dict) -> dict:
    """Map genvm-lint's nested {lint, validate} `check` output onto our flat schema."""
    errors = parsed.get("validate", {}).get("errors", []) or []
    warnings = parsed.get("lint", {}).get("warnings", []) or []
    return {
        "ok": bool(parsed.get("ok", False)),
        "errors": [_shape_issue(e) for e in errors[:MAX_ISSUES]],
        "warnings": [_shape_issue(w) for w in warnings[:MAX_ISSUES]],
    }


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.post("/lint")
async def lint(request: Request, x_lint_secret: str | None = Header(default=None)) -> JSONResponse:
    if not LINT_SECRET or x_lint_secret != LINT_SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")

    body = await request.body()
    if len(body) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="contract too large")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="invalid JSON body")
    source = payload.get("contract")
    if not isinstance(source, str) or not source.strip():
        raise HTTPException(status_code=400, detail="contract required")

    t0 = time.monotonic()
    raw = ""

    # Acquire a subprocess slot. Fail fast as 503 if the queue is backed
    # up beyond LINT_QUEUE_WAIT_S — better signal to the caller than
    # holding the request open and racing the client's own timeout.
    sem = _get_sem()
    try:
        await asyncio.wait_for(sem.acquire(), timeout=LINT_QUEUE_WAIT_S)
    except asyncio.TimeoutError:
        log.warning("lint queue saturated; waited %.1fs", LINT_QUEUE_WAIT_S)
        raise HTTPException(status_code=503, detail="lint queue saturated; retry")
    queue_wait_ms = int((time.monotonic() - t0) * 1000)

    try:
        try:
            with temp_contract(source) as path:
                # Run the blocking subprocess on a worker thread so the
                # event loop stays free to serve healthchecks and queue
                # the next request. asyncio.to_thread propagates the
                # subprocess exceptions (TimeoutExpired, FileNotFoundError)
                # back up unchanged.
                proc = await asyncio.to_thread(
                    subprocess.run,
                    [GENVM_LINT_BIN, "check", path, "--json"],
                    capture_output=True,
                    text=True,
                    timeout=LINT_TIMEOUT_S,
                )
            raw = (proc.stdout or proc.stderr or "")[:MAX_RAW_BYTES]
            if not proc.stdout.strip():
                log.error("lint produced no stdout; rc=%s", proc.returncode)
                raise HTTPException(status_code=502, detail="lint produced no output")
            parsed = json.loads(proc.stdout)
        except subprocess.TimeoutExpired:
            log.warning("lint timeout after %.1fs (queue_wait_ms=%d)", LINT_TIMEOUT_S, queue_wait_ms)
            raise HTTPException(status_code=504, detail="lint timeout")
        except json.JSONDecodeError:
            log.error("lint stdout was not valid JSON")
            raise HTTPException(status_code=502, detail="lint output unparseable")
        except FileNotFoundError:
            log.error("genvm-lint binary not found")
            raise HTTPException(status_code=500, detail="linter unavailable")
    finally:
        sem.release()

    if "lint" not in parsed or "validate" not in parsed:
        log.error("lint output schema unexpected — missing 'lint' or 'validate'")
        raise HTTPException(status_code=502, detail="lint output schema drift")

    result = normalize(parsed)
    result["raw"] = raw[:MAX_RAW_BYTES]
    duration_ms = int((time.monotonic() - t0) * 1000)
    log.info(
        "lint ok=%s errors=%d warnings=%d duration_ms=%d queue_wait_ms=%d",
        result["ok"], len(result["errors"]), len(result["warnings"]), duration_ms, queue_wait_ms,
    )
    return JSONResponse(result)
