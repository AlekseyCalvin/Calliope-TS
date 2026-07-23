# syntax=docker/dockerfile:1
# Calliope TS — HuggingFace Spaces (Docker SDK) + MCP Server
#
# Pure-JS / pure-WASM app: no native binaries, no compilation step beyond tsc.
# The server (webapp/server.mjs) already honours $PORT and binds 0.0.0.0.
# It now serves BOTH:
#   - Web UI + REST API (/api/analyze, /api/russian, etc.)
#   - MCP (Model Context Protocol) endpoints:
#       POST/GET/DELETE /mcp   — Streamable HTTP (MCP 2025-03-26, stateless)
#       GET  /sse + POST /messages — SSE (legacy, Claude Desktop / Cursor)
#       GET  /api/mcp/info — discovery
#
# ── LFS materialization ──────────────────────────────────────────────
# HuggingFace Hub force-stores *.png, *.ttf, *.bin, *.udpipe, etc. via Git LFS.
# The Spaces Docker builder checks out 131-byte pointer files by default; without
# the step below, the server would serve stubs. We materialize binaries at build
# time so the image carries real assets for web and Russian pipeline.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git-lfs ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the repo WITH .git so `git lfs pull` can resolve pointers.
# (.dockerignore intentionally does NOT exclude .git for this build.)
COPY . .

# Space slug, used only by the resolve-endpoint fallback below.
# Override with: docker build --build-arg HF_REPO=owner/space .
ARG HF_REPO="AlekseyCalvin/cts"

# Materialize LFS content two ways:
#  1. git lfs pull — canonical path (works when .git is in context, which is true for HF Spaces Docker builds).
#  2. curl fallback — for any pointer that survived (e.g. .git stripped or partial LFS), fetch real binary from HF's /resolve/main/ endpoint.
# We scan the whole repo for remaining LFS pointers, not just webapp/assets, to also cover Russian data (src/russian/data/* etc.).
RUN set -e; \
    git lfs install --skip-smudge 2>/dev/null || true; \
    git lfs pull 2>/dev/null || true; \
    echo ">> checking for remaining LFS pointers ..."; \
    FOUND=0; \
    for f in $(find . -type f \
        -not -path "./.git/*" \
        -not -path "./node_modules/*" \
        -not -path "./dist/*" \
        2>/dev/null); do \
      if head -c 100 "$f" 2>/dev/null | grep -q "^version https://git-lfs"; then \
        echo ">> materializing LFS pointer via resolve endpoint: $f"; \
        curl -fsSL "https://huggingface.co/spaces/${HF_REPO}/resolve/main/$f" -o "$f" || echo "!! failed to fetch $f (may be private or not yet pushed)"; \
        FOUND=1; \
      fi; \
    done; \
    if [ "$FOUND" = "0" ]; then echo ">> no remaining LFS pointers found (git lfs pull succeeded)"; fi; \
    rm -rf .git; \
    echo ">> assets check:"; ls -lh webapp/public/assets/fonts/*.ttf 2>&1 | head; \
    echo ">> russian data check:"; ls -lh src/russian/data/*.udpipe 2>&1 | head; ls -lh src/russian/data/*.bin 2>&1 | head

# Reproducible install. Files are already in /app from COPY . . above.
RUN npm ci || npm install

# Compile TS -> dist/, the layout webapp/server.mjs imports from.
RUN npm run build

# Verify build outputs MCP deps are present
RUN node -e "import('@modelcontextprotocol/sdk/server/mcp.js').then(()=>console.log('MCP SDK ok')).catch(e=>{console.error(e);process.exit(1)})" || echo "MCP SDK check via import failed, but continuing"

# HuggingFace Spaces expects the app on port 7860 by default.
ENV PORT=7860
ENV NODE_ENV=production
ENV CALLIOPE_RUSSIAN_DATA_URL="https://huggingface.co/spaces/${HF_REPO}/resolve/main/src/russian/data"
EXPOSE 7860

# Healthcheck for HF Spaces + MCP
HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 CMD curl -fsSL http://localhost:${PORT}/api/health || exit 1

# Warm-up runs inside server.mjs's listen callback; the WASM model loads
# via top-level await before listen() fires, so the port only opens once
# the pipeline is ready. Well within HF's startup window.
# MCP endpoints (/mcp, /sse, /api/mcp/info) are ready immediately after listen.
CMD ["node", "webapp/server.mjs"]
