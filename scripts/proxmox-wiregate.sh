#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
WireGate Proxmox LXC helper

Usage:
  scripts/proxmox-wiregate.sh <command> [options]

Commands:
  create    Create a fresh Proxmox LXC and install WireGate
  update    Update WireGate inside an existing LXC
  destroy   Stop and destroy an existing LXC
  help      Show this help

Examples:
  sudo bash scripts/proxmox-wiregate.sh create --ctid 120 --hostname wiregate
  sudo bash scripts/proxmox-wiregate.sh update --ctid 120
  sudo bash scripts/proxmox-wiregate.sh destroy --ctid 120

Run the underlying helper with --help for command-specific options.
EOF
}

command="${1:-help}"
if [[ $# -gt 0 ]]; then
  shift
fi

case "$command" in
  create)
    exec bash "$SCRIPT_DIR/proxmox-create-lxc.sh" "$@"
    ;;
  update)
    exec bash "$SCRIPT_DIR/proxmox-update-lxc.sh" "$@"
    ;;
  destroy)
    exec bash "$SCRIPT_DIR/proxmox-destroy-lxc.sh" "$@"
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    printf 'Unknown command: %s\n\n' "$command" >&2
    usage >&2
    exit 1
    ;;
esac
