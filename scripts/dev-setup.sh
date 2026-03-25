#!/usr/bin/env bash
# scripts/dev-setup.sh
# Prepares the local development environment:
#   1. Creates .dev-data/ directories (no privilege needed)
#   2. Generates a WireGuard key pair for wgdev0 (no privilege needed)
#   3. Writes .dev-data/wireguard/wgdev0.conf  (no privilege needed)
#   4. Brings up the wgdev0 interface via sudo wg-quick (needs sudo)
#
# Safe to run repeatedly — idempotent at every step.
# Usage:  ./scripts/dev-setup.sh   or   make dev-setup

set -euo pipefail

IFACE="wgdev0"

# Resolve repo root regardless of where the script is called from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

WG_DIR="${ROOT_DIR}/.dev-data/wireguard"
DATA_DIR="${ROOT_DIR}/.dev-data"
CONF_FILE="${WG_DIR}/${IFACE}.conf"

SERVER_ADDR="10.200.0.1/24"
LISTEN_PORT="51821"

# ── Helpers ───────────────────────────────────────────────────────────────────
info() { printf '  \033[36m[dev-setup]\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32m[dev-setup]\033[0m ✓ %s\n' "$*"; }
warn() { printf '  \033[33m[dev-setup]\033[0m ! %s\n' "$*"; }

# ── Check wireguard-tools ────────────────────────────────────────────────────
if ! command -v wg &>/dev/null || ! command -v wg-quick &>/dev/null; then
  warn "wireguard-tools not found (wg / wg-quick missing)."
  warn "Install with one of:"
  warn "  sudo apt install wireguard          # Debian / Ubuntu / WSL2"
  warn "  sudo dnf install wireguard-tools    # Fedora / RHEL"
  warn "  brew install wireguard-tools        # macOS"
  warn ""
  warn "The backend will start but will report WireGuard as not installed."
  warn "Re-run 'make dev-setup' after installing wireguard-tools."
  exit 0   # non-fatal: let the rest of 'make dev' continue
fi

# ── Create data directories ───────────────────────────────────────────────────
mkdir -p "${DATA_DIR}" "${WG_DIR}"
ok "data dirs ready  (${DATA_DIR}/)"

# ── Generate key pair ─────────────────────────────────────────────────────────
PRIVKEY_FILE="${WG_DIR}/${IFACE}.privkey"
PUBKEY_FILE="${WG_DIR}/${IFACE}.pubkey"

if [[ ! -f "${PRIVKEY_FILE}" ]]; then
  info "Generating WireGuard key pair for ${IFACE} ..."
  wg genkey | tee "${PRIVKEY_FILE}" | wg pubkey > "${PUBKEY_FILE}"
  chmod 600 "${PRIVKEY_FILE}"
  ok "Key pair generated"
else
  ok "Key pair already present"
fi

PRIVKEY="$(cat "${PRIVKEY_FILE}")"

# ── Write wg-quick config ─────────────────────────────────────────────────────
if [[ ! -f "${CONF_FILE}" ]]; then
  info "Writing ${CONF_FILE} ..."
  cat > "${CONF_FILE}" <<EOF
# wg-quick config for WireGate local dev — managed by scripts/dev-setup.sh
[Interface]
Address    = ${SERVER_ADDR}
ListenPort = ${LISTEN_PORT}
PrivateKey = ${PRIVKEY}
EOF
  chmod 600 "${CONF_FILE}"
  ok "${CONF_FILE} written"
else
  ok "${CONF_FILE} already present"
fi

# ── Bring up the interface (requires sudo) ────────────────────────────────────
if sudo wg show "${IFACE}" &>/dev/null 2>&1; then
  ok "Interface ${IFACE} already up"
else
  info "Bringing up ${IFACE} (sudo required) ..."
  if sudo wg-quick up "${CONF_FILE}"; then
    ok "Interface ${IFACE} is up"
  else
    warn "Could not bring up ${IFACE} automatically."
    warn "Run this manually, then retry 'make dev':"
    warn "  sudo wg-quick up ${CONF_FILE}"
    exit 1
  fi
fi

printf '\n'
printf '  Interface : %s  (%s)\n' "${IFACE}" "${SERVER_ADDR}"
printf '  WG port   : %s/udp\n'   "${LISTEN_PORT}"
printf '  Config    : %s\n'        "${CONF_FILE}"
printf '\n'
