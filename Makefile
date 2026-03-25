# Build
.PHONY: all build backend frontend clean dev

all: build

## Build both backend and frontend
build: backend frontend

## Build Go backend binary
backend:
	cd backend && CGO_ENABLED=1 go build -o ../bin/wiregate ./cmd/wiregate

## Build React frontend
frontend:
	cd frontend && pnpm build

## Run backend in development mode (hot-reload requires 'air')
dev-backend:
	cd backend && WIREGATE_SERVER_STATIC_DIR=../frontend/dist go run ./cmd/wiregate

## Run frontend in development mode with HMR
dev-frontend:
	cd frontend && pnpm dev

## Install Go dev tools
tools:
	go install github.com/air-verse/air@latest

## Run all tests
test:
	cd backend && CGO_ENABLED=1 go test ./... -v

## Format Go code
fmt:
	cd backend && gofmt -w .

## Build Docker image
docker:
	docker build -t wiregate:local .

## Run with Docker Compose
up:
	docker compose up -d

## Stop Docker Compose stack
down:
	docker compose down

## Clean build artifacts
clean:
	rm -rf bin/ frontend/dist/ backend/wiregate

## Print help
help:
	@echo "WireGate Makefile targets:"
	@echo "  build          - Build backend and frontend"
	@echo "  backend        - Build Go backend only"
	@echo "  frontend       - Build React frontend only"
	@echo "  dev-backend    - Run backend in dev mode"
	@echo "  dev-frontend   - Run frontend dev server"
	@echo "  test           - Run backend tests"
	@echo "  docker         - Build Docker image"
	@echo "  up             - Start with docker-compose"
	@echo "  down           - Stop docker-compose"
	@echo "  clean          - Remove build artifacts"
