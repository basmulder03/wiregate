#!/usr/bin/env bash
# scripts/dev-teardown.sh
# Brings down the wgdev0 WireGuard interface created by dev-setup.sh.
# Called automatically when 'make dev' exits (Ctrl-C trap).
# Usage:  ./scripts/dev-teardown.sh   or   make dev-teardown

set -euo pipefail

IFACE="wgdev0"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONF_FILE="${ROOT_DIR}/.dev-data/wireguard/${IFACE}.conf"

ok() { printf '  \033[32m[dev-teardown]\033[0m ✓ %s\n' "$*"; }

if ! command -v wg &>/dev/null; then
  ok "wg not found — nothing to tear down"
  exit 0
fi

if sudo wg show "${IFACE}" &>/dev/null 2>&1; then
  printf '  \033[36m[dev-teardown]\033[0m Bringing down %s ...\n' "${IFACE}"
  sudo wg-quick down "${CONF_FILE}"
  ok "Interface ${IFACE} removed"
else
  ok "Interface ${IFACE} was not up — nothing to do"
fi
