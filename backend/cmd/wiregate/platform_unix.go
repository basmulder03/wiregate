//go:build !windows

package main

import (
	"os"
	"path/filepath"
	"runtime"
)

// platformDataDir returns the best writable data directory for the current platform.
//   - Linux  (root):        /var/lib/wiregate
//   - Linux  (non-root):    ~/.local/share/wiregate
//   - macOS:                ~/Library/Application Support/wiregate
func platformDataDir() string {
	if runtime.GOOS == "linux" && os.Getuid() == 0 {
		return "/var/lib/wiregate"
	}
	if dir, err := os.UserConfigDir(); err == nil {
		return filepath.Join(dir, "wiregate")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".wiregate")
}

// platformWireGuardDir returns the default WireGuard config directory.
//   - Linux (root):   /etc/wireguard
//   - Linux (user):   ~/.config/wireguard
//   - macOS:          ~/Library/Application Support/wireguard/configs
func platformWireGuardDir() string {
	if runtime.GOOS == "linux" && os.Getuid() == 0 {
		return "/etc/wireguard"
	}
	if dir, err := os.UserConfigDir(); err == nil {
		return filepath.Join(dir, "wireguard")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".wireguard")
}
