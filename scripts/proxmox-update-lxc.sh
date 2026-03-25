#!/usr/bin/env bash
set -euo pipefail

REPO="basmulder03/wiregate"
CTID="${CTID:-120}"

info() { printf '\033[36m[proxmox-wiregate-update]\033[0m %s\n' "$*"; }
ok() { printf '\033[32m[proxmox-wiregate-update]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[proxmox-wiregate-update]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Update WireGate inside an existing Proxmox LXC.

Usage:
  scripts/proxmox-update-lxc.sh [options]

Options:
  --ctid ID         Container ID (default: 120)
  --version TAG     Release tag to install (default: latest)
  --help            Show this help
EOF
}

VERSION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ctid) CTID="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || die "Run this script as root on the Proxmox host."
command -v pct >/dev/null 2>&1 || die "Required tool not found: pct"
command -v curl >/dev/null 2>&1 || die "Required tool not found: curl"

case "$(uname -m)" in
  x86_64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) die "Unsupported host architecture: $(uname -m)" ;;
esac

latest_release() {
  curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | awk -F '"' '/tag_name/ { print $4; exit }'
}

[[ -n "$VERSION" ]] || VERSION="$(latest_release)"
[[ -n "$VERSION" ]] || die "Could not determine release version."
[[ "$VERSION" == v* ]] || VERSION="v${VERSION}"

ARCHIVE="wiregate_${VERSION#v}_linux_${ARCH}.tar.gz"
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${ARCHIVE}"

pct status "$CTID" >/dev/null 2>&1 || die "Container ${CTID} does not exist."

if ! pct exec "$CTID" -- true >/dev/null 2>&1; then
  info "Starting container ${CTID} ..."
  pct start "$CTID" >/dev/null
  sleep 3
fi

info "Updating runtime packages inside container ${CTID} ..."
pct exec "$CTID" -- bash -lc "export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y --no-install-recommends ca-certificates curl wireguard-tools iptables iproute2 qrencode && rm -rf /var/lib/apt/lists/*"

info "Installing WireGate ${VERSION} inside container ${CTID} ..."
pct exec "$CTID" -- bash -lc "set -euo pipefail; tmp=\$(mktemp -d); trap 'rm -rf \"\$tmp\"' EXIT; curl -fsSL '$DOWNLOAD_URL' -o \"\$tmp/$ARCHIVE\"; tar -xzf \"\$tmp/$ARCHIVE\" -C \"\$tmp\"; install -m 0755 \"\$tmp/wiregate\" /usr/local/bin/wiregate; systemctl restart wiregate"

ok "WireGate ${VERSION} installed and service restarted in container ${CTID}."
