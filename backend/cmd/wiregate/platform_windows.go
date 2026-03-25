//go:build windows

package main

import (
	"os"
	"path/filepath"
)

// platformDataDir returns the AppData\Local\wiregate directory on Windows.
func platformDataDir() string {
	if dir, err := os.UserConfigDir(); err == nil {
		return filepath.Join(dir, "wiregate")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "AppData", "Local", "wiregate")
}

// platformWireGuardDir returns the WireGuard config directory on Windows.
// The WireGuard for Windows app stores tunnels in %ProgramData%\WireGuard\;
// we use AppData for user-local configs.
func platformWireGuardDir() string {
	if programData := os.Getenv("ProgramData"); programData != "" {
		return filepath.Join(programData, "WireGuard")
	}
	return filepath.Join(platformDataDir(), "wireguard")
}
