# WireGate UI

React + TypeScript frontend for the WireGate WireGuard management application.

## Development

```bash
pnpm install
pnpm dev        # starts Vite dev server on :5173, proxies /api → :8080
```

## Build

```bash
pnpm build      # outputs to dist/
```

The built `dist/` directory is embedded into the final Docker image and served by the Go backend.
