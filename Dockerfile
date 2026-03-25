# ── Stage 1: Build frontend ──────────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend
RUN corepack enable pnpm
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend/ .
RUN pnpm build

# ── Stage 2: Build backend (with embedded UI) ─────────────────────────────────
FROM golang:1.25-alpine AS backend-builder

# CGO required for sqlite3
RUN apk add --no-cache gcc musl-dev

WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ .

# Embed the compiled frontend into the go:embed source directory
COPY --from=frontend-builder /app/frontend/dist ./internal/static/ui

RUN CGO_ENABLED=1 GOOS=linux go build \
    -trimpath \
    -ldflags="-w -s" \
    -o wiregate \
    ./cmd/wiregate

# ── Stage 3: Final image ──────────────────────────────────────────────────────
FROM debian:bookworm-slim

# Install WireGuard, iptables, and runtime deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    wireguard-tools \
    iptables \
    iproute2 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create wiregate user and directories
RUN useradd -r -s /bin/false wiregate || true
RUN mkdir -p /var/lib/wiregate /etc/wireguard && chmod 700 /etc/wireguard

# Binary already contains the embedded UI — no separate www directory needed
COPY --from=backend-builder /app/wiregate /usr/local/bin/wiregate

EXPOSE 8080

# WireGuard requires NET_ADMIN + SYS_MODULE capabilities (set via docker run)
VOLUME ["/var/lib/wiregate", "/etc/wireguard"]

# The binary serves the embedded UI by default.
# Set WIREGATE_SERVER_STATIC_DIR to an existing directory to override with files on disk.
ENV WIREGATE_DATABASE_DSN=/var/lib/wiregate/wiregate.db \
    WIREGATE_SERVER_PORT=8080 \
    WIREGATE_WIREGUARD_CONFIG_DIR=/etc/wireguard

ENTRYPOINT ["/usr/local/bin/wiregate"]
