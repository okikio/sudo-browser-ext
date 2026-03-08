# syntax=docker/dockerfile:1

# ── Builder stage ─────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

# Build arguments for build-time configuration
ARG BUILD_TARGET=chrome
ARG PNPM_VERSION=10.18.3

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /app

# Copy dependency manifests first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install dependencies (use frozen lockfile for reproducibility)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Copy the rest of the source
COPY . .

# Build the extension based on target (chrome or firefox)
RUN if [ "$BUILD_TARGET" = "firefox" ]; then \
      pnpm run build:firefox && pnpm run package:firefox; \
    else \
      pnpm run build && pnpm run package; \
    fi

# ── Artifact stage ────────────────────────────────────────────────────────────
# Minimal image that just holds the built extension artifacts
FROM scratch AS artifacts

ARG BUILD_TARGET=chrome

COPY --from=builder /app/build /build

# ── Runtime stage ─────────────────────────────────────────────────────────────
# A lightweight server that exposes the built extension artifacts for download
# and can be configured entirely via environment variables.
FROM node:24-alpine AS runtime

LABEL org.opencontainers.image.title="P-Stream Browser Extension Builder"
LABEL org.opencontainers.image.description="Build and serve P-Stream browser extension artifacts"
LABEL org.opencontainers.image.source="https://github.com/okikio/sudo-browser-ext"
LABEL org.opencontainers.image.licenses="MIT"

# Runtime environment variables
# BUILD_TARGET: chrome (default) or firefox
# PORT: HTTP port for the built-in artifact server (default: 3000)
ENV BUILD_TARGET=chrome \
    PORT=3000 \
    NODE_ENV=production

WORKDIR /app

# Copy built artifacts from builder
COPY --from=builder /app/build ./build

# Copy a minimal static file server
COPY --from=builder /app/package.json ./package.json

# Install only a minimal static server — no build toolchain needed at runtime
RUN npm install --global serve@14 --ignore-scripts

EXPOSE ${PORT}

# Healthcheck: verify the server responds
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:${PORT}/ || exit 1

# Use Docker secrets for sensitive values by sourcing them from /run/secrets
# e.g.: docker run --secret id=my_secret,src=./secret.txt ...
# The entrypoint reads optional secret files and sets them as env vars.
COPY <<'EOF' /entrypoint.sh
#!/bin/sh
set -e

# Load any Docker secrets from /run/secrets/ into the environment
if [ -d /run/secrets ]; then
  for f in /run/secrets/*; do
    [ -f "$f" ] || continue
    key=$(basename "$f")
    val=$(cat "$f")
    export "$key=$val"
  done
fi

# Determine which build directory to serve
if [ "$BUILD_TARGET" = "firefox" ]; then
  SERVE_DIR="/app/build/firefox-mv3-prod"
else
  SERVE_DIR="/app/build/chrome-mv3-prod"
fi

exec serve -s "$SERVE_DIR" -l "$PORT"
EOF

RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
