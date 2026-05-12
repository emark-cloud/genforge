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
# and warms to ~3s. Keep this above the GenForge client's per-request
# timeout so the client wins the race when traffic is bursty.
LINT_TIMEOUT_S = float(os.environ.get("LINT_TIMEOUT_S", "8"))
GENVM_LINT_BIN = os.environ.get("GENVM_LINT_BIN", "genvm-lint")

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
    try:
        with temp_contract(source) as path:
            proc = subprocess.run(
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
        log.warning("lint timeout after %.1fs", LINT_TIMEOUT_S)
        raise HTTPException(status_code=504, detail="lint timeout")
    except json.JSONDecodeError:
        log.error("lint stdout was not valid JSON")
        raise HTTPException(status_code=502, detail="lint output unparseable")
    except FileNotFoundError:
        log.error("genvm-lint binary not found")
        raise HTTPException(status_code=500, detail="linter unavailable")

    if "lint" not in parsed or "validate" not in parsed:
        log.error("lint output schema unexpected — missing 'lint' or 'validate'")
        raise HTTPException(status_code=502, detail="lint output schema drift")

    result = normalize(parsed)
    result["raw"] = raw[:MAX_RAW_BYTES]
    duration_ms = int((time.monotonic() - t0) * 1000)
    log.info(
        "lint ok=%s errors=%d warnings=%d duration_ms=%d",
        result["ok"], len(result["errors"]), len(result["warnings"]), duration_ms,
    )
    return JSONResponse(result)
