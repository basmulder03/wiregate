# WireGate Makefile
.PHONY: all build backend frontend clean dev release \
        release-linux-amd64 release-linux-arm64 \
        release-darwin-amd64 release-darwin-arm64 \
        release-windows-amd64 \
        dev-backend dev-frontend tools test fmt docker up down help

all: build

## ── Primary build ────────────────────────────────────────────────────────────

## Build backend + frontend; copies dist into backend/internal/static/ui for go:embed
build: frontend embed-ui backend

## Build React frontend
frontend:
	cd frontend && pnpm install --frozen-lockfile && pnpm build

## Copy frontend/dist into the go:embed source directory
embed-ui:
	@echo "Copying frontend/dist → backend/internal/static/ui"
	rm -rf backend/internal/static/ui
	cp -r frontend/dist backend/internal/static/ui

## Build Go backend binary (single binary with embedded UI)
backend:
	mkdir -p bin
	cd backend && CGO_ENABLED=1 go build -trimpath \
	  -ldflags="-s -w" \
	  -o ../bin/wiregate ./cmd/wiregate

## ── Cross-platform release builds ───────────────────────────────────────────
## Requires a C toolchain for each target (see README).
## Use 'make release' to build all targets at once.

release: frontend embed-ui \
         release-linux-amd64 release-linux-arm64 \
         release-darwin-amd64 release-darwin-arm64 \
         release-windows-amd64
	@echo "All release binaries in bin/"

release-linux-amd64:
	mkdir -p bin
	cd backend && CGO_ENABLED=1 GOOS=linux GOARCH=amd64 CC=x86_64-linux-gnu-gcc \
	  go build -trimpath -ldflags="-s -w" -o ../bin/wiregate-linux-amd64 ./cmd/wiregate

release-linux-arm64:
	mkdir -p bin
	cd backend && CGO_ENABLED=1 GOOS=linux GOARCH=arm64 CC=aarch64-linux-gnu-gcc \
	  go build -trimpath -ldflags="-s -w" -o ../bin/wiregate-linux-arm64 ./cmd/wiregate

release-darwin-amd64:
	mkdir -p bin
	cd backend && CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 \
	  go build -trimpath -ldflags="-s -w" -o ../bin/wiregate-darwin-amd64 ./cmd/wiregate

release-darwin-arm64:
	mkdir -p bin
	cd backend && CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 \
	  go build -trimpath -ldflags="-s -w" -o ../bin/wiregate-darwin-arm64 ./cmd/wiregate

release-windows-amd64:
	mkdir -p bin
	cd backend && CGO_ENABLED=1 GOOS=windows GOARCH=amd64 CC=x86_64-w64-mingw32-gcc \
	  go build -trimpath -ldflags="-s -w" -o ../bin/wiregate-windows-amd64.exe ./cmd/wiregate

## ── Development ──────────────────────────────────────────────────────────────

## Run backend in development mode (frontend proxied via Vite HMR)
dev-backend:
	cd backend && WIREGATE_SERVER_STATIC_DIR="" go run ./cmd/wiregate

## Run frontend dev server (proxies /api to localhost:8080)
dev-frontend:
	cd frontend && pnpm dev

## Install Go dev tools (air for hot-reload)
tools:
	go install github.com/air-verse/air@latest

## ── Quality ──────────────────────────────────────────────────────────────────

## Run all backend tests
test:
	cd backend && CGO_ENABLED=1 go test ./... -v

## Format Go code
fmt:
	cd backend && gofmt -w .

## ── Docker ───────────────────────────────────────────────────────────────────

## Build Docker image locally
docker:
	docker build -t wiregate:local .

## Start with Docker Compose
up:
	docker compose up -d

## Stop Docker Compose stack
down:
	docker compose down

## ── Clean ────────────────────────────────────────────────────────────────────

clean:
	rm -rf bin/ frontend/dist/ backend/internal/static/ui
	mkdir -p backend/internal/static/ui
	touch backend/internal/static/ui/.gitkeep backend/internal/static/ui/README

## ── Help ─────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "WireGate build targets:"
	@echo ""
	@echo "  build                  Build backend + frontend (single embedded binary)"
	@echo "  frontend               Build React UI only"
	@echo "  backend                Build Go binary only (requires embed-ui first)"
	@echo "  embed-ui               Copy frontend/dist into go:embed source dir"
	@echo ""
	@echo "  release                Build all release binaries"
	@echo "  release-linux-amd64    Linux  x86-64"
	@echo "  release-linux-arm64    Linux  ARM64 (Raspberry Pi, etc.)"
	@echo "  release-darwin-amd64   macOS  Intel"
	@echo "  release-darwin-arm64   macOS  Apple Silicon"
	@echo "  release-windows-amd64  Windows x86-64"
	@echo ""
	@echo "  dev-backend            Run backend (serves API only, Vite proxies to it)"
	@echo "  dev-frontend           Run Vite dev server"
	@echo "  test                   Run backend tests"
	@echo "  docker                 Build Docker image"
	@echo "  up / down              Start/stop Docker Compose"
	@echo "  clean                  Remove build artifacts"
	@echo ""
