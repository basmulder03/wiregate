# ── Stage 1: Build frontend ──────────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend
RUN corepack enable pnpm
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend/ .
RUN pnpm build

# ── Stage 2: Build backend ────────────────────────────────────────────────────
FROM golang:1.25-alpine AS backend-builder

# CGO required for sqlite3
RUN apk add --no-cache gcc musl-dev

WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ .
RUN CGO_ENABLED=1 GOOS=linux go build \
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
RUN mkdir -p /var/lib/wiregate /etc/wireguard
RUN chmod 700 /etc/wireguard

# Copy backend binary
COPY --from=backend-builder /app/wiregate /usr/local/bin/wiregate

# Copy frontend build output - will be served by the Go server
COPY --from=frontend-builder /app/frontend/dist /var/lib/wiregate/www

# Expose port
EXPOSE 8080

# WireGuard requires NET_ADMIN + SYS_MODULE capabilities (set via docker run)
# Data volume for persistent config + database
VOLUME ["/var/lib/wiregate", "/etc/wireguard"]

# Default environment
ENV WIREGATE_DATABASE_DSN=/var/lib/wiregate/wiregate.db \
    WIREGATE_SERVER_PORT=8080 \
    WIREGATE_WIREGUARD_CONFIG_DIR=/etc/wireguard

ENTRYPOINT ["/usr/local/bin/wiregate"]
