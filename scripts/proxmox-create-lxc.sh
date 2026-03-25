#!/usr/bin/env bash
set -euo pipefail

REPO="basmulder03/wiregate"

CTID="${CTID:-120}"
HOSTNAME="${HOSTNAME:-wiregate}"
STORAGE="${STORAGE:-local-lvm}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
BRIDGE="${BRIDGE:-vmbr0}"
IP_CONFIG="${IP_CONFIG:-dhcp}"
CORES="${CORES:-2}"
MEMORY="${MEMORY:-2048}"
SWAP="${SWAP:-512}"
DISK_GB="${DISK_GB:-8}"
WIREGATE_PORT="${WIREGATE_PORT:-8080}"
WG_INTERFACE="${WG_INTERFACE:-wg0}"
DATA_DIR="${DATA_DIR:-/var/lib/wiregate}"
WG_DIR="${WG_DIR:-/etc/wireguard}"
START_AFTER_CREATE=1

info() { printf '\033[36m[proxmox-wiregate]\033[0m %s\n' "$*"; }
ok() { printf '\033[32m[proxmox-wiregate]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[proxmox-wiregate]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[proxmox-wiregate]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Create a fresh Proxmox LXC and install WireGate inside it.

Usage:
  scripts/proxmox-create-lxc.sh [options]

Options:
  --ctid ID                 Container ID (default: 120)
  --hostname NAME           Container hostname (default: wiregate)
  --storage NAME            Rootfs storage for the LXC (default: local-lvm)
  --template-storage NAME   Storage that holds Debian templates (default: local)
  --bridge NAME             Proxmox bridge for eth0 (default: vmbr0)
  --ip-config VALUE         LXC IP config, e.g. dhcp or 192.168.1.50/24,gw=192.168.1.1
  --cores N                 CPU cores (default: 2)
  --memory MB               RAM in MB (default: 2048)
  --swap MB                 Swap in MB (default: 512)
  --disk GB                 Root disk size in GB (default: 8)
  --web-port PORT           WireGate web port inside the container (default: 8080)
  --wg-interface NAME       WireGuard interface name (default: wg0)
  --no-start                Create/install but do not start the container service
  --help                    Show this help

Examples:
  sudo scripts/proxmox-create-lxc.sh --ctid 120 --hostname wiregate
  sudo scripts/proxmox-create-lxc.sh --ctid 121 --ip-config '10.0.10.50/24,gw=10.0.10.1'
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ctid) CTID="$2"; shift 2 ;;
    --hostname) HOSTNAME="$2"; shift 2 ;;
    --storage) STORAGE="$2"; shift 2 ;;
    --template-storage) TEMPLATE_STORAGE="$2"; shift 2 ;;
    --bridge) BRIDGE="$2"; shift 2 ;;
    --ip-config) IP_CONFIG="$2"; shift 2 ;;
    --cores) CORES="$2"; shift 2 ;;
    --memory) MEMORY="$2"; shift 2 ;;
    --swap) SWAP="$2"; shift 2 ;;
    --disk) DISK_GB="$2"; shift 2 ;;
    --web-port) WIREGATE_PORT="$2"; shift 2 ;;
    --wg-interface) WG_INTERFACE="$2"; shift 2 ;;
    --no-start) START_AFTER_CREATE=0; shift ;;
    --help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || die "Run this script as root on the Proxmox host."

for tool in pct pveam curl tar openssl awk sed grep; do
  command -v "$tool" >/dev/null 2>&1 || die "Required tool not found: $tool"
done

ensure_host_wireguard() {
  if ! command -v wg >/dev/null 2>&1; then
    info "Installing WireGuard tooling on the Proxmox host ..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update >/dev/null
    apt-get install -y --no-install-recommends wireguard-tools >/dev/null
  fi

  mkdir -p /etc/modules-load.d
  printf 'wireguard\n' > /etc/modules-load.d/wiregate-wireguard.conf
  printf 'tun\n' > /etc/modules-load.d/wiregate-tun.conf

  if ! modprobe wireguard 2>/dev/null; then
    warn "Could not load the wireguard kernel module on the Proxmox host."
    warn "Make sure the host kernel supports WireGuard before starting the container."
  fi

  if ! modprobe tun 2>/dev/null; then
    warn "Could not load the tun kernel module on the Proxmox host."
    warn "The container needs /dev/net/tun to bring up WireGuard interfaces."
  fi

  if [[ ! -e /dev/net/tun ]]; then
    die "/dev/net/tun is missing on the Proxmox host. WireGuard in the container will not work."
  fi
}

case "$(uname -m)" in
  x86_64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) die "Unsupported Proxmox host architecture: $(uname -m)" ;;
esac

ensure_host_wireguard

latest_release() {
  curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | awk -F '"' '/tag_name/ { print $4; exit }'
}

find_template_file() {
  pveam update >/dev/null
  pveam available --section system | awk -v arch="$ARCH" '
    $0 ~ "debian-12-standard" && $0 ~ arch {
      file=$2
      sub(/^.*\//, "", file)
      print file
      exit
    }
  '
}

ensure_template() {
  local template_file
  template_file="$(find_template_file)"
  [[ -n "$template_file" ]] || die "Could not find a Debian 12 LXC template for ${ARCH}."

  if ! pveam list "$TEMPLATE_STORAGE" | awk '{print $2}' | grep -qx "$template_file"; then
    info "Downloading ${template_file} to ${TEMPLATE_STORAGE} ..."
    pveam download "$TEMPLATE_STORAGE" "$template_file" >/dev/null
  fi

  printf '%s:vztmpl/%s\n' "$TEMPLATE_STORAGE" "$template_file"
}

ensure_config_line() {
  local config_file="$1"
  local line="$2"
  grep -Fqx "$line" "$config_file" || printf '%s\n' "$line" >> "$config_file"
}

wait_for_systemd() {
  local tries=0
  until pct exec "$CTID" -- systemctl is-system-running >/dev/null 2>&1 || [[ $tries -ge 30 ]]; do
    tries=$((tries + 1))
    sleep 2
  done
}

WIREGATE_VERSION="${WIREGATE_VERSION:-$(latest_release)}"
[[ -n "$WIREGATE_VERSION" ]] || die "Could not determine the latest WireGate release."
ARCHIVE="wiregate_${WIREGATE_VERSION#v}_linux_${ARCH}.tar.gz"
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${WIREGATE_VERSION}/${ARCHIVE}"
JWT_SECRET="${WIREGATE_SERVER_JWT_SECRET:-$(openssl rand -hex 32)}"
TEMPLATE_VOLID="$(ensure_template)"

if pct status "$CTID" >/dev/null 2>&1; then
  die "Container ${CTID} already exists. Choose a different --ctid."
fi

info "Creating LXC ${CTID} (${HOSTNAME}) ..."
pct create "$CTID" "$TEMPLATE_VOLID" \
  --hostname "$HOSTNAME" \
  --cores "$CORES" \
  --memory "$MEMORY" \
  --swap "$SWAP" \
  --rootfs "${STORAGE}:${DISK_GB}" \
  --net0 "name=eth0,bridge=${BRIDGE},ip=${IP_CONFIG}" \
  --features nesting=1,keyctl=1 \
  --onboot 1 \
  --unprivileged 1 >/dev/null

CONFIG_FILE="/etc/pve/lxc/${CTID}.conf"
ensure_config_line "$CONFIG_FILE" "lxc.apparmor.profile: unconfined"
ensure_config_line "$CONFIG_FILE" "lxc.cgroup2.devices.allow: c 10:200 rwm"
ensure_config_line "$CONFIG_FILE" "lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file"

info "Starting container ${CTID} ..."
pct start "$CTID" >/dev/null
wait_for_systemd

info "Installing runtime packages inside the container ..."
pct exec "$CTID" -- bash -lc "export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y --no-install-recommends ca-certificates curl wireguard-tools iptables iproute2 qrencode && rm -rf /var/lib/apt/lists/*"

info "Installing WireGate ${WIREGATE_VERSION} inside the container ..."
pct exec "$CTID" -- bash -lc "set -euo pipefail; tmp=\$(mktemp -d); trap 'rm -rf \"\$tmp\"' EXIT; curl -fsSL '$DOWNLOAD_URL' -o \"\$tmp/$ARCHIVE\"; tar -xzf \"\$tmp/$ARCHIVE\" -C \"\$tmp\"; install -m 0755 \"\$tmp/wiregate\" /usr/local/bin/wiregate; mkdir -p '$DATA_DIR' '$WG_DIR'; chmod 700 '$WG_DIR'"

info "Writing WireGate environment and service files ..."
pct exec "$CTID" -- bash -lc "cat > /etc/default/wiregate <<'EOF'
WIREGATE_SERVER_HOST=0.0.0.0
WIREGATE_SERVER_PORT=$WIREGATE_PORT
WIREGATE_SERVER_JWT_SECRET=$JWT_SECRET
WIREGATE_DATABASE_DSN=$DATA_DIR/wiregate.db
WIREGATE_WIREGUARD_CONFIG_DIR=$WG_DIR
WIREGATE_WIREGUARD_INTERFACE=$WG_INTERFACE
EOF
cat > /etc/systemd/system/wiregate.service <<'EOF'
[Unit]
Description=WireGate
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/default/wiregate
ExecStart=/usr/local/bin/wiregate
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
cat > /etc/sysctl.d/99-wiregate.conf <<'EOF'
net.ipv4.ip_forward=1
net.ipv4.conf.all.src_valid_mark=1
EOF
sysctl --system >/dev/null || true
systemctl daemon-reload
systemctl enable wiregate >/dev/null"

if [[ "$START_AFTER_CREATE" -eq 1 ]]; then
  info "Starting WireGate service inside the container ..."
  pct exec "$CTID" -- systemctl restart wiregate
fi

CONTAINER_IP="$(pct exec "$CTID" -- bash -lc "hostname -I | awk '{print \$1}'" 2>/dev/null || true)"

ok "Container ${CTID} is ready."
printf '\n'
printf '  Hostname     : %s\n' "$HOSTNAME"
printf '  CTID         : %s\n' "$CTID"
printf '  WireGate     : %s\n' "$WIREGATE_VERSION"
printf '  Web UI       : http://%s:%s\n' "${CONTAINER_IP:-<container-ip>}" "$WIREGATE_PORT"
printf '  WG interface : %s\n' "$WG_INTERFACE"
printf '  JWT secret   : %s\n' "$JWT_SECRET"
printf '\n'
printf '  Notes:\n'
printf '  - The container uses bridged networking on %s.\n' "$BRIDGE"
printf '  - Expose/forward UDP 51820 (or your chosen WireGuard port) to the container IP as needed.\n'
printf '  - If the Proxmox firewall is enabled, allow TCP %s to the container and UDP 51820 to the WireGuard interface.\n' "$WIREGATE_PORT"
printf '  - If your LXC sits behind NAT, forward TCP %s and your chosen WireGuard UDP port from the edge router to %s.\n' "$WIREGATE_PORT" "${CONTAINER_IP:-<container-ip>}"
printf '  - On Proxmox, bridged mode is usually simplest for WireGuard so clients can reach the container directly.\n'
printf '  - Complete first-run setup in the web UI after opening the URL above.\n'
