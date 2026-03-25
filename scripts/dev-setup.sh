#!/usr/bin/env bash
# scripts/dev-setup.sh
# Creates the wgdev0 WireGuard interface and local data directories used during
# development.  Safe to run repeatedly — skips steps that are already done.
#
# Usage:  ./scripts/dev-setup.sh      (or via 'make dev-setup' / 'make dev')
#
# Requirements:
#   • wireguard-tools (wg, wg-quick) installed
#   • sudo access (only needed to bring up the network interface)

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
IFACE="wgdev0"
WG_DIR=".dev-data/wireguard"
DATA_DIR=".dev-data"
CONF_FILE="${WG_DIR}/${IFACE}.conf"
# Private subnet used exclusively for the dev instance.
SERVER_ADDR="10.200.0.1/24"
# UDP port for the dev WireGuard instance (different from the default 51820 to
# avoid clashing with a production wg0 that may already be running).
LISTEN_PORT="51821"

# ── Resolve repo root ─────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

# ── Helpers ───────────────────────────────────────────────────────────────────
info()  { echo "  [dev-setup] $*"; }
ok()    { echo "  [dev-setup] ✓ $*"; }
warn()  { echo "  [dev-setup] ! $*"; }

# ── Check prerequisites ───────────────────────────────────────────────────────
if ! command -v wg &>/dev/null || ! command -v wg-quick &>/dev/null; then
  echo ""
  echo "  ERROR: wireguard-tools not found."
  echo "  Install with:  sudo apt install wireguard  (Debian/Ubuntu)"
  echo "                 sudo dnf install wireguard-tools  (Fedora/RHEL)"
  echo ""
  exit 1
fi

# ── Create local data directories ─────────────────────────────────────────────
mkdir -p "${DATA_DIR}" "${WG_DIR}"
ok "data dirs ready (${DATA_DIR}/)"

# ── Generate server key pair if not present ───────────────────────────────────
PRIVKEY_FILE="${WG_DIR}/${IFACE}.privkey"
PUBKEY_FILE="${WG_DIR}/${IFACE}.pubkey"

if [[ ! -f "${PRIVKEY_FILE}" ]]; then
  info "Generating WireGuard key pair for ${IFACE} ..."
  wg genkey | tee "${PRIVKEY_FILE}" | wg pubkey > "${PUBKEY_FILE}"
  chmod 600 "${PRIVKEY_FILE}"
  ok "Key pair generated"
else
  ok "Key pair already exists"
fi

PRIVKEY="$(cat "${PRIVKEY_FILE}")"

# ── Write wg-quick config ─────────────────────────────────────────────────────
if [[ ! -f "${CONF_FILE}" ]]; then
  info "Writing ${CONF_FILE} ..."
  cat > "${CONF_FILE}" <<EOF
# wg-quick config for WireGate local development instance.
# Managed by scripts/dev-setup.sh — do not edit by hand.
[Interface]
Address    = ${SERVER_ADDR}
ListenPort = ${LISTEN_PORT}
PrivateKey = ${PRIVKEY}
EOF
  chmod 600 "${CONF_FILE}"
  ok "${CONF_FILE} written"
else
  ok "${CONF_FILE} already exists"
fi

# ── Bring up the interface ────────────────────────────────────────────────────
if sudo wg show "${IFACE}" &>/dev/null 2>&1; then
  ok "Interface ${IFACE} already up"
else
  info "Bringing up ${IFACE} (requires sudo) ..."
  sudo wg-quick up "${CONF_FILE}"
  ok "Interface ${IFACE} is up"
fi

echo ""
echo "  Dev environment ready."
echo "    Interface : ${IFACE}  (${SERVER_ADDR})"
echo "    WG port   : ${LISTEN_PORT}/udp"
echo "    Data dir  : ${DATA_DIR}/"
echo "    Config    : ${CONF_FILE}"
echo ""
