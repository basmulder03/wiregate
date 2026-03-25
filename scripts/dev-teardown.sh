#!/usr/bin/env bash
# scripts/dev-teardown.sh
# Brings down the wgdev0 WireGuard interface created by dev-setup.sh.
# Called automatically when 'make dev' exits (via trap).
#
# Usage:  ./scripts/dev-teardown.sh   (or via 'make dev-teardown')

set -euo pipefail

IFACE="wgdev0"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONF_FILE="${ROOT_DIR}/.dev-data/wireguard/${IFACE}.conf"

info()  { echo "  [dev-teardown] $*"; }
ok()    { echo "  [dev-teardown] ✓ $*"; }

if sudo wg show "${IFACE}" &>/dev/null 2>&1; then
  info "Bringing down ${IFACE} ..."
  sudo wg-quick down "${CONF_FILE}"
  ok "Interface ${IFACE} removed"
else
  ok "Interface ${IFACE} was not up — nothing to do"
fi
