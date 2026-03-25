#!/usr/bin/env bash
set -euo pipefail

CTID="${CTID:-120}"
PURGE=0

info() { printf '\033[36m[proxmox-wiregate-destroy]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[proxmox-wiregate-destroy]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[proxmox-wiregate-destroy]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Stop and destroy a Proxmox LXC created for WireGate.

Usage:
  scripts/proxmox-destroy-lxc.sh [options]

Options:
  --ctid ID       Container ID (default: 120)
  --purge         Destroy without interactive confirmation
  --help          Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ctid) CTID="$2"; shift 2 ;;
    --purge) PURGE=1; shift ;;
    --help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || die "Run this script as root on the Proxmox host."
command -v pct >/dev/null 2>&1 || die "Required tool not found: pct"

pct status "$CTID" >/dev/null 2>&1 || die "Container ${CTID} does not exist."

if [[ "$PURGE" -ne 1 ]]; then
  warn "This will permanently destroy container ${CTID} and its root filesystem."
  read -r -p "Type 'destroy' to continue: " answer
  [[ "$answer" == "destroy" ]] || die "Aborted."
fi

if pct status "$CTID" | grep -q running; then
  info "Stopping container ${CTID} ..."
  pct stop "$CTID" >/dev/null
fi

info "Destroying container ${CTID} ..."
pct destroy "$CTID" --purge 1 >/dev/null

printf '\033[32m[proxmox-wiregate-destroy]\033[0m Container %s removed.\n' "$CTID"
