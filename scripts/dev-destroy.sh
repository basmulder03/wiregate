#!/usr/bin/env bash
# scripts/dev-destroy.sh
# Fully resets local development state so you can bootstrap from scratch.
# Removes:
#   - .dev-data/ (SQLite DB + dev WireGuard config)
#   - runtime WireGuard state under ${XDG_RUNTIME_DIR:-/tmp}/wiregate-$USER
# Also attempts to bring down wgdev0 first when present.

set -euo pipefail

IFACE="wgdev0"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

DEV_DATA_DIR="${ROOT_DIR}/.dev-data"
RUNTIME_BASE="${XDG_RUNTIME_DIR:-/tmp}/wiregate-${USER:-dev}"
RUNTIME_WG_DIR="${RUNTIME_BASE}/wireguard"
LEGACY_RUNTIME_WG_DIR="${XDG_RUNTIME_DIR:-}/wireguard"

ok() { printf '  \033[32m[dev-destroy]\033[0m %s\n' "$*"; }
info() { printf '  \033[36m[dev-destroy]\033[0m %s\n' "$*"; }

if command -v wg >/dev/null 2>&1 && command -v wg-quick >/dev/null 2>&1; then
  if sudo wg show "${IFACE}" >/dev/null 2>&1; then
    info "Bringing down ${IFACE} before cleanup ..."
    if [[ -f "${RUNTIME_WG_DIR}/${IFACE}.conf" ]]; then
      sudo wg-quick down "${RUNTIME_WG_DIR}/${IFACE}.conf" || true
    elif [[ -f "${DEV_DATA_DIR}/wireguard/${IFACE}.conf" ]]; then
      sudo wg-quick down "${DEV_DATA_DIR}/wireguard/${IFACE}.conf" || true
    else
      sudo ip link delete "${IFACE}" || true
    fi
    ok "Interface ${IFACE} removed"
  else
    ok "Interface ${IFACE} not active"
  fi
else
  ok "WireGuard tools not found; skipping interface teardown"
fi

if [[ -d "${DEV_DATA_DIR}" ]]; then
  rm -rf "${DEV_DATA_DIR}"
  ok "Removed ${DEV_DATA_DIR}"
else
  ok "No ${DEV_DATA_DIR} directory"
fi

if [[ -d "${RUNTIME_BASE}" ]]; then
  rm -rf "${RUNTIME_BASE}"
  ok "Removed ${RUNTIME_BASE}"
else
  ok "No ${RUNTIME_BASE} runtime directory"
fi

# Cleanup legacy path from older dev scripts without touching the full XDG runtime dir.
if [[ -n "${XDG_RUNTIME_DIR:-}" && -d "${LEGACY_RUNTIME_WG_DIR}" ]]; then
  rm -f "${LEGACY_RUNTIME_WG_DIR}/${IFACE}.conf" \
        "${LEGACY_RUNTIME_WG_DIR}/${IFACE}.privkey" \
        "${LEGACY_RUNTIME_WG_DIR}/${IFACE}.pubkey"
  rmdir "${LEGACY_RUNTIME_WG_DIR}" 2>/dev/null || true
  ok "Cleaned legacy runtime WireGuard files in ${LEGACY_RUNTIME_WG_DIR}"
fi

printf '\n'
ok "Development state reset complete"
ok "Next step: run 'make dev' to bootstrap everything again"
