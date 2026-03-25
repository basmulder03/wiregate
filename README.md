# WireGate

A lightweight WireGuard management UI. Runs as a single self-contained binary on Linux, macOS, and Windows — or as a Docker container with WireGuard bundled inside.

![Dashboard](https://raw.githubusercontent.com/basmulder03/wiregate/main/.github/assets/dashboard.png)

---

## Features

- **Client management** — create, enable/disable, and delete WireGuard peers; download `.conf` files or scan QR codes directly from the UI
- **Client expiry** — set an optional expiry date per client; expired clients are automatically disconnected and disabled
- **Live connection monitor** — real-time peer stats (endpoint, handshake time, RX/TX) via WebSocket, auto-refreshing every 5 seconds
- **Multiple auth methods** — username + password, TOTP/2FA, OIDC/OAuth2 (Google, Authentik, Keycloak, …), API keys
- **Audit log** — every write action is recorded with username, IP address, and outcome
- **First-run wizard** — guided setup for admin account + WireGuard server config
- **Self-contained binary** — frontend is embedded via `go:embed`; no separate web server or static file directory needed

---

## Quick start

### Docker (recommended)

```sh
curl -fsSL https://raw.githubusercontent.com/basmulder03/wiregate/main/docker-compose.yml -o docker-compose.yml
# Edit WIREGATE_SERVER_JWT_SECRET before starting
docker compose up -d
```

Then open **http://localhost:8080** and follow the setup wizard.

`docker-compose.yml`:

```yaml
services:
  wiregate:
    image: ghcr.io/basmulder03/wiregate:latest
    container_name: wiregate
    restart: unless-stopped
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    sysctls:
      - net.ipv4.conf.all.src_valid_mark=1
      - net.ipv4.ip_forward=1
    ports:
      - "8080:8080"         # Web UI
      - "51820:51820/udp"   # WireGuard VPN
    volumes:
      - wiregate_data:/var/lib/wiregate
      - wiregate_wg:/etc/wireguard
    environment:
      WIREGATE_SERVER_JWT_SECRET: "change-me-to-a-random-64-char-string"

volumes:
  wiregate_data:
  wiregate_wg:
```

> **Generate a secret:** `openssl rand -hex 32`

---

### Bare-metal — Linux / macOS

```sh
curl -fsSL https://raw.githubusercontent.com/basmulder03/wiregate/main/install.sh | bash
```

The interactive installer will:
1. Download the correct binary for your OS and architecture
2. Optionally install WireGuard tools (via your package manager or Homebrew)
3. Optionally register a systemd service (Linux root) or launchd agent (macOS)

### Bare-metal — Windows

Run in PowerShell **as Administrator**:

```powershell
irm https://raw.githubusercontent.com/basmulder03/wiregate/main/install.ps1 | iex
```

The installer optionally installs WireGuard via `winget` and registers a Windows service.

### Manual binary install

Download the binary for your platform from the [latest release](https://github.com/basmulder03/wiregate/releases/latest), then run it directly:

```sh
# Linux / macOS
chmod +x wiregate
export WIREGATE_SERVER_JWT_SECRET=$(openssl rand -hex 32)
./wiregate

# Windows (PowerShell)
$env:WIREGATE_SERVER_JWT_SECRET = -join ((65..90)+(97..122)+(48..57) | Get-Random -Count 32 | % {[char]$_})
.\wiregate.exe
```

Open **http://localhost:8080** to complete setup.

---

## Configuration

WireGate is configured via environment variables, a YAML config file, or a mix of both.

### Config file

Create `wiregate.yaml` in `/etc/wiregate/`, `~/.wiregate/`, or the current working directory:

```yaml
server:
  host: 0.0.0.0
  port: 8080
  jwt_secret: "your-secret-here"   # Required for persistent sessions
  jwt_expiry_hours: 24
  tls_enabled: false
  tls_cert_file: ""
  tls_key_file: ""

database:
  driver: sqlite
  dsn: /var/lib/wiregate/wiregate.db

wireguard:
  config_dir: /etc/wireguard
  interface: wg0
  auto_apply: true
```

### Environment variables

All config keys are also available as environment variables with the `WIREGATE_` prefix (dots become underscores):

| Variable | Default | Description |
|---|---|---|
| `WIREGATE_SERVER_HOST` | `0.0.0.0` | Bind address |
| `WIREGATE_SERVER_PORT` | `8080` | HTTP port |
| `WIREGATE_SERVER_JWT_SECRET` | *(random, not persistent)* | **Set this.** Sessions are invalidated on restart if unset. |
| `WIREGATE_SERVER_JWT_EXPIRY_HOURS` | `24` | Token lifetime in hours |
| `WIREGATE_SERVER_TLS_ENABLED` | `false` | Enable HTTPS |
| `WIREGATE_SERVER_TLS_CERT_FILE` | | Path to TLS certificate |
| `WIREGATE_SERVER_TLS_KEY_FILE` | | Path to TLS private key |
| `WIREGATE_SERVER_ALLOWED_ORIGINS` | `["*"]` | CORS allowed origins |
| `WIREGATE_DATABASE_DRIVER` | `sqlite` | Database driver (`sqlite`) |
| `WIREGATE_DATABASE_DSN` | platform default | Path to SQLite database file |
| `WIREGATE_WIREGUARD_CONFIG_DIR` | platform default | Directory for WireGuard `.conf` files |
| `WIREGATE_WIREGUARD_INTERFACE` | `wg0` | WireGuard interface name |
| `WIREGATE_WIREGUARD_AUTO_APPLY` | `true` | Write and reload WireGuard config on change |

#### Platform data directory defaults

| Platform | Data directory | WireGuard config dir |
|---|---|---|
| Linux (root) | `/var/lib/wiregate` | `/etc/wireguard` |
| Linux (user) | `~/.config/wiregate` | `~/.config/wireguard` |
| macOS | `~/Library/Application Support/wiregate` | `~/Library/Application Support/wireguard` |
| Windows | `%LOCALAPPDATA%\WireGate` | `%ProgramData%\WireGuard` |
| Docker | `/var/lib/wiregate` | `/etc/wireguard` |

---

## Authentication

### Username + password

Created during the first-run setup wizard. Only one admin account exists by default.

### TOTP / 2FA

Enable in **Settings → Security**. Scan the QR code with any TOTP app (Google Authenticator, Authy, 1Password, …). A valid 6-digit code is required to disable 2FA.

### OIDC / OAuth2

Configure a provider via the API (or the settings UI in a future release):

```sh
curl -X POST http://localhost:8080/api/settings/oidc \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "provider_name": "google",
    "issuer_url":    "https://accounts.google.com",
    "client_id":     "YOUR_CLIENT_ID",
    "client_secret": "YOUR_CLIENT_SECRET",
    "redirect_url":  "http://your-wiregate-host:8080/api/auth/oidc/google/callback",
    "scopes":        "openid,email,profile",
    "enabled":       true
  }'
```

The provider name appears as a login button on the sign-in page. Multiple providers can be configured.

### API keys

Create in **Settings → API Keys**. The full key is shown only once at creation time. Keys can be scoped (`read`, `write`) and given an expiry date.

Use in requests:

```sh
curl http://localhost:8080/api/clients \
  -H "Authorization: Bearer wg_..."
```

---

## Client expiry

When creating a client, an optional expiry date can be set. Once the date passes:

1. The client is automatically disconnected from the live WireGuard interface.
2. The client is marked as **disabled** in the database.
3. It is excluded from all future WireGuard config regeneration.

The expiry enforcer runs once per minute in the background. The UI shows colour-coded expiry badges:

| Badge | Meaning |
|---|---|
| Grey "Never" | No expiry set |
| Green date | Expires in more than 7 days |
| Yellow date | Expires within 7 days |
| Red "Expired" | Already expired |

---

## Building from source

**Prerequisites:** Go 1.25+, Node 22+, pnpm, gcc (for CGO/SQLite on Linux/Windows)

```sh
git clone https://github.com/basmulder03/wiregate.git
cd wiregate

# Build everything (frontend + embedded binary)
make build

# Binary is at bin/wiregate
./bin/wiregate
```

### Development mode

Run the backend and frontend dev servers separately for hot-reload:

```sh
# Terminal 1 — Go backend (API on :8080)
make dev-backend

# Terminal 2 — Vite dev server (UI on :5173, proxies /api to :8080)
make dev-frontend
```

### Cross-platform release builds

```sh
make release-linux-amd64
make release-linux-arm64
make release-darwin-amd64    # CGO_ENABLED=0, uses pure-Go SQLite
make release-darwin-arm64
make release-windows-amd64
```

Or build all at once: `make release`

Cross-compiling Linux targets requires `gcc-aarch64-linux-gnu` / `gcc-x86-64-linux-gnu`. Windows requires `gcc-mingw-w64-x86-64`. macOS targets use `CGO_ENABLED=0` (pure-Go SQLite driver) and can be built from any platform.

---

## Releasing

Push a version tag to trigger the release pipeline:

```sh
git tag v1.0.0
git push origin v1.0.0
```

This will:
1. Build binaries for all 5 platforms via GoReleaser
2. Publish a GitHub Release with `.tar.gz` / `.zip` archives and a SHA256 checksum file
3. Build and push a multi-arch Docker image (`linux/amd64`, `linux/arm64`) to GHCR with `:latest` and `:<version>` tags

---

## API reference

All routes are prefixed with `/api`. Authentication uses `Authorization: Bearer <token>` (JWT from login or an API key).

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | — | Password login (+ optional `totp_code`) |
| `GET` | `/api/auth/me` | ✓ | Current user info |
| `POST` | `/api/auth/totp/setup` | ✓ | Begin TOTP enrollment |
| `POST` | `/api/auth/totp/confirm` | ✓ | Activate TOTP with a valid code |
| `POST` | `/api/auth/totp/disable` | ✓ | Disable TOTP |
| `POST` | `/api/auth/api-keys` | ✓ | Create API key |
| `GET` | `/api/auth/api-keys` | ✓ | List API keys |
| `DELETE` | `/api/auth/api-keys/:id` | ✓ | Revoke API key |

### Setup

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/setup/status` | — | Check if first-run setup is needed |
| `POST` | `/api/auth/setup` | — | Create initial admin account |

### Server

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/server` | admin | WireGuard server config |
| `PUT` | `/api/server` | admin | Update server config |
| `GET` | `/api/server/status` | admin | Running state + systemd status |
| `POST` | `/api/server/start` | admin | Start WireGuard |
| `POST` | `/api/server/stop` | admin | Stop WireGuard |
| `POST` | `/api/server/restart` | admin | Restart WireGuard |

### Clients

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/clients` | ✓ | List all clients |
| `POST` | `/api/clients` | admin | Create client |
| `GET` | `/api/clients/:id` | ✓ | Get client |
| `PUT` | `/api/clients/:id` | admin | Update client |
| `DELETE` | `/api/clients/:id` | admin | Delete client |
| `GET` | `/api/clients/:id/config` | ✓ | Download `.conf` file |
| `GET` | `/api/clients/:id/qr` | ✓ | QR code image (PNG) |

### Connections

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/connections` | ✓ | Live peer stats |
| `DELETE` | `/api/connections/:pubkey` | admin | Disconnect a peer |

### Settings

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/settings/endpoint` | admin | Public endpoint |
| `PUT` | `/api/settings/endpoint` | admin | Set public endpoint |
| `GET` | `/api/settings/oidc` | admin | OIDC provider config |
| `POST` | `/api/settings/oidc` | admin | Create/update OIDC provider |

### Audit

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/audit` | admin | Audit log (`?limit=100`) |

### OIDC

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/auth/oidc/providers` | — | List enabled providers |
| `GET` | `/api/auth/oidc/:provider/login` | — | Get OIDC redirect URL |
| `GET` | `/api/auth/oidc/:provider/callback` | — | OAuth2 callback |

### WebSocket

| Path | Auth | Description |
|---|---|---|
| `/api/ws` | ✓ | Live peer updates (token passed as `?token=`) |

---

## Stack

| Layer | Technology |
|---|---|
| Backend | Go 1.25, Gin, GORM |
| Database | SQLite (`mattn/go-sqlite3` with CGO; `glebarez/sqlite` pure-Go for Darwin/Windows cross-builds) |
| Auth | JWT, TOTP (`pquerna/otp`), OIDC (`coreos/go-oidc/v3`) |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, TanStack Query |
| Build | `go:embed` (single binary), GoReleaser, Docker multi-stage |

---

## License

MIT
