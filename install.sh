#!/usr/bin/env bash
# WireGate interactive installer — Linux & macOS
# Usage: curl -fsSL https://raw.githubusercontent.com/basmulder03/wiregate/main/install.sh | bash
#    or: bash install.sh
set -euo pipefail

REPO="basmulder03/wiregate"
INSTALL_DIR="/usr/local/bin"
SERVICE_NAME="wiregate"

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[wiregate]${RESET} $*"; }
success() { echo -e "${GREEN}[wiregate]${RESET} $*"; }
warn()    { echo -e "${YELLOW}[wiregate]${RESET} $*"; }
error()   { echo -e "${RED}[wiregate] ERROR:${RESET} $*" >&2; exit 1; }
ask()     { echo -en "${BOLD}$* ${RESET}"; }

PROMPT_TTY=""
if [[ -r /dev/tty && -w /dev/tty ]]; then
  PROMPT_TTY="/dev/tty"
fi

prompt_default() {
  local label="$1" default="$2" answer=""
  if [[ -n "$PROMPT_TTY" ]]; then
    printf "${BOLD}%s [%s]: ${RESET}" "$label" "$default" > "$PROMPT_TTY"
    IFS= read -r answer < "$PROMPT_TTY" || true
  else
    warn "No interactive TTY detected; using default for '${label}': ${default}"
  fi
  printf '%s' "${answer:-$default}"
}

prompt_yn() {
  local label="$1" default="$2" answer=""
  if [[ -n "$PROMPT_TTY" ]]; then
    printf "${BOLD}%s [%s]: ${RESET}" "$label" "$default" > "$PROMPT_TTY"
    IFS= read -r answer < "$PROMPT_TTY" || true
  else
    warn "No interactive TTY detected; using default for '${label}': ${default}"
  fi
  printf '%s' "${answer:-$default}"
}

# ── Platform detection ───────────────────────────────────────────────────────
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  ARCH="amd64"  ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) error "Unsupported architecture: $ARCH" ;;
esac

[[ "$OS" == "linux" || "$OS" == "darwin" ]] || error "This script supports Linux and macOS only."

# ── Helpers ──────────────────────────────────────────────────────────────────
has() { command -v "$1" &>/dev/null; }

require_tool() {
  has curl || has wget || error "curl or wget is required to download WireGate."
  has tar   || error "tar is required to extract the archive."
}

download() {
  local url="$1" dest="$2"
  if has curl; then curl -fsSL "$url" -o "$dest"
  else              wget -qO   "$dest" "$url"; fi
}

latest_version() {
  local api_url="https://api.github.com/repos/${REPO}/releases/latest"
  if has curl; then
    curl -fsSL "$api_url" | grep '"tag_name"' | sed 's/.*"tag_name": *"\(.*\)".*/\1/'
  else
    wget -qO- "$api_url"  | grep '"tag_name"' | sed 's/.*"tag_name": *"\(.*\)".*/\1/'
  fi
}

# ── Banner ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  ██╗    ██╗██╗██████╗ ███████╗ ██████╗  █████╗ ████████╗███████╗${RESET}"
echo -e "${BOLD}  ██║    ██║██║██╔══██╗██╔════╝██╔════╝ ██╔══██╗╚══██╔══╝██╔════╝${RESET}"
echo -e "${BOLD}  ██║ █╗ ██║██║██████╔╝█████╗  ██║  ███╗███████║   ██║   █████╗  ${RESET}"
echo -e "${BOLD}  ██║███╗██║██║██╔══██╗██╔══╝  ██║   ██║██╔══██║   ██║   ██╔══╝  ${RESET}"
echo -e "${BOLD}  ╚███╔███╔╝██║██║  ██║███████╗╚██████╔╝██║  ██║   ██║   ███████╗${RESET}"
echo -e "${BOLD}   ╚══╝╚══╝ ╚═╝╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝${RESET}"
echo ""
echo -e "  ${CYAN}WireGuard management for humans${RESET}"
echo ""

# ── Pre-flight checks ────────────────────────────────────────────────────────
require_tool

# ── Version selection ────────────────────────────────────────────────────────
info "Fetching latest release…"
VERSION="$(latest_version)"
[[ -n "$VERSION" ]] || error "Could not determine latest version. Check https://github.com/${REPO}/releases"
info "Latest version: ${BOLD}${VERSION}${RESET}"

VERSION_INPUT="$(prompt_default "Install version" "$VERSION")"
[[ "$VERSION_INPUT" == v* ]] || VERSION_INPUT="v${VERSION_INPUT}"

# ── Install directory ────────────────────────────────────────────────────────
DEFAULT_DIR="$INSTALL_DIR"
if [[ "$OS" == "darwin" ]] || [[ "$(id -u)" -ne 0 ]]; then
  DEFAULT_DIR="$HOME/.local/bin"
fi

INSTALL_DIR="$(prompt_default "Install directory" "$DEFAULT_DIR")"
mkdir -p "$INSTALL_DIR"

# ── Download ─────────────────────────────────────────────────────────────────
ARCHIVE="wiregate_${VERSION_INPUT#v}_${OS}_${ARCH}.tar.gz"
URL="https://github.com/${REPO}/releases/download/${VERSION_INPUT}/${ARCHIVE}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

info "Downloading ${ARCHIVE}…"
download "$URL" "${TMP}/${ARCHIVE}"

info "Extracting…"
tar -xzf "${TMP}/${ARCHIVE}" -C "$TMP"
chmod +x "${TMP}/wiregate"
mv "${TMP}/wiregate" "${INSTALL_DIR}/wiregate"

success "Binary installed → ${INSTALL_DIR}/wiregate"

# ── PATH hint ────────────────────────────────────────────────────────────────
if ! echo "$PATH" | grep -q "$INSTALL_DIR"; then
  warn "  ${INSTALL_DIR} is not in your PATH."
  warn "  Add it:  export PATH=\"\$PATH:${INSTALL_DIR}\""
fi

# ── WireGuard installation ───────────────────────────────────────────────────
if ! command -v wg &>/dev/null; then
  echo ""
  INSTALL_WG="$(prompt_yn "WireGuard tools not found. Install them now?" "Y")"
  if [[ "$INSTALL_WG" =~ ^[Yy]$ ]]; then
    info "Installing WireGuard…"
    if [[ "$OS" == "darwin" ]]; then
      if has brew; then
        brew install wireguard-tools
      else
        warn "Homebrew not found. Install from https://brew.sh then run: brew install wireguard-tools"
      fi
    else
      # Linux — try common package managers
      if   has apt-get; then sudo apt-get install -y wireguard
      elif has dnf;     then sudo dnf install -y wireguard-tools
      elif has yum;     then sudo yum install -y wireguard-tools
      elif has pacman;  then sudo pacman -Sy --noconfirm wireguard-tools
      elif has apk;     then sudo apk add --no-cache wireguard-tools
      else warn "Could not detect package manager. Install wireguard-tools manually."; fi
    fi
  fi
fi

# ── Systemd service (Linux only) ─────────────────────────────────────────────
if [[ "$OS" == "linux" ]] && has systemctl && [[ "$(id -u)" -eq 0 ]]; then
  echo ""
  INSTALL_SVC="$(prompt_yn "Install and enable the WireGate systemd service?" "Y")"
  if [[ "$INSTALL_SVC" =~ ^[Yy]$ ]]; then
    DATA_DIR="/var/lib/wiregate"
    mkdir -p "$DATA_DIR"

    PORT="$(prompt_default "Port to listen on" "8080")"

    WG_IFACE="$(prompt_default "WireGuard interface name" "wg0")"

    info "Writing /etc/systemd/system/wiregate.service…"
    cat > /etc/systemd/system/wiregate.service <<EOF
[Unit]
Description=WireGate — WireGuard management UI
After=network.target

[Service]
Type=simple
ExecStart=${INSTALL_DIR}/wiregate
Restart=on-failure
RestartSec=5
Environment=WIREGATE_SERVER_PORT=${PORT}
Environment=WIREGATE_WIREGUARD_INTERFACE=${WG_IFACE}
Environment=WIREGATE_DATABASE_DSN=${DATA_DIR}/wiregate.db
Environment=WIREGATE_SERVER_STATIC_DIR=${DATA_DIR}/www

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable --now "$SERVICE_NAME"
    success "Service started. Access WireGate at http://localhost:${PORT}"
  fi
fi

# ── macOS LaunchAgent ─────────────────────────────────────────────────────────
if [[ "$OS" == "darwin" ]]; then
  echo ""
  INSTALL_AGENT="$(prompt_yn "Install a launchd agent to start WireGate on login?" "Y")"
  if [[ "$INSTALL_AGENT" =~ ^[Yy]$ ]]; then
    PLIST_DIR="$HOME/Library/LaunchAgents"
    PLIST="${PLIST_DIR}/io.wiregate.server.plist"
    DATA_DIR="$HOME/Library/Application Support/wiregate"
    mkdir -p "$PLIST_DIR" "$DATA_DIR"

    PORT="$(prompt_default "Port to listen on" "8080")"

    WG_IFACE="$(prompt_default "WireGuard interface name" "wg0")"

    # Generate a stable JWT secret so sessions survive restarts.
    if has openssl; then
      JWT_SECRET="$(openssl rand -hex 32)"
    else
      JWT_SECRET="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 64)"
    fi

    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>io.wiregate.server</string>
  <key>ProgramArguments</key>  <array><string>${INSTALL_DIR}/wiregate</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>WIREGATE_SERVER_PORT</key>          <string>${PORT}</string>
    <key>WIREGATE_DATABASE_DSN</key>         <string>${DATA_DIR}/wiregate.db</string>
    <key>WIREGATE_WIREGUARD_INTERFACE</key>  <string>${WG_IFACE}</string>
    <key>WIREGATE_SERVER_JWT_SECRET</key>    <string>${JWT_SECRET}</string>
  </dict>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <true/>
  <key>StandardErrorPath</key> <string>${DATA_DIR}/wiregate.log</string>
  <key>StandardOutPath</key>   <string>${DATA_DIR}/wiregate.log</string>
</dict>
</plist>
EOF
    launchctl load "$PLIST"
    success "LaunchAgent installed. Access WireGate at http://localhost:${PORT}"
  fi
fi

echo ""
success "WireGate ${VERSION_INPUT} installed successfully!"
echo ""
echo -e "  Run manually:  ${BOLD}${INSTALL_DIR}/wiregate${RESET}"
echo -e "  Set JWT secret: ${BOLD}export WIREGATE_SERVER_JWT_SECRET=\$(openssl rand -hex 32)${RESET}"
echo ""
