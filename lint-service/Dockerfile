FROM python:3.12-slim

# Pinned at build time so production matches src/lib/genlayer-version.ts.
# Bump together with that file when py-genlayer cuts a new release.
ARG GENVM_VERSION=v0.2.16

WORKDIR /app

RUN pip install --no-cache-dir \
    genvm-linter==0.10.0 \
    fastapi==0.115.6 \
    uvicorn==0.32.1

# Pre-cache the GenVM SDK so /lint requests don't pay a download cost
# (and time out) on the first call after the machine boots.
RUN genvm-lint download -v "${GENVM_VERSION}"

# Pre-warm pyright by running validate once at build time. Without this,
# the first /lint request that calls `check` cold-starts pyright (~40s on
# overlayfs). Subsequent runs reuse the binary cache pyright lays down.
# This also surfaces SDK/pyright bootstrap failures at build time, not at
# request time. Failure here is non-fatal; the resulting image still works
# even if the warmup doesn't.
RUN printf '# v0.1.0\n# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }\nfrom genlayer import *\n\nclass C(gl.Contract):\n    n: u256\n    def __init__(self):\n        self.n = u256(0)\n' > /tmp/warmup.py && \
    genvm-lint validate /tmp/warmup.py --json > /dev/null 2>&1 || true && \
    rm -f /tmp/warmup.py

COPY app.py /app/app.py

EXPOSE 8080
CMD ["uvicorn", "--app-dir", "/app", "app:app", "--host", "0.0.0.0", "--port", "8080"]
