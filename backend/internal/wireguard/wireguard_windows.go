//go:build windows

package wireguard

import (
	"fmt"
	"log"
	"os/exec"
	"strings"
)

// IsInstalled checks if the WireGuard tunnel service / CLI tools are available.
// On Windows, WireGuard ships as a GUI application; the `wg` CLI may or may not be on PATH.
func IsInstalled() bool {
	_, err := exec.LookPath("wg")
	return err == nil
}

// InstallWireGuard attempts to install WireGuard on Windows using winget (Windows 11/10 22H2+)
// or by printing instructions to download the MSI installer.
func InstallWireGuard() error {
	if _, err := exec.LookPath("winget"); err == nil {
		log.Println("wireguard: installing via winget")
		out, err := exec.Command("winget", "install", "--id", "WireGuard.WireGuard", "-e", "--silent").CombinedOutput()
		if err != nil {
			return fmt.Errorf("winget install failed: %s: %w", string(out), err)
		}
		return nil
	}
	return fmt.Errorf(
		"winget not found — download the WireGuard installer from https://www.wireguard.com/install/ " +
			"and ensure the 'wg' CLI is on your PATH (usually C:\\Program Files\\WireGuard\\)")
}

// IsRunning checks if the WireGuard tunnel is active.
// On Windows, wg-quick does not exist; the tunnel is managed by the WireGuard service.
func (m *Manager) IsRunning() bool {
	out, err := exec.Command("wg", "show", m.iface).CombinedOutput()
	if err != nil {
		return false
	}
	return strings.Contains(string(out), "interface")
}

// Start brings up the WireGuard tunnel on Windows.
// Requires the WireGuard service to be running and the tunnel to be imported.
func (m *Manager) Start() error {
	out, err := exec.Command("wg", "show", m.iface).CombinedOutput()
	_ = out
	if err == nil {
		return nil // already running
	}
	// Windows WireGuard uses the tunnel service; try net start
	o2, err2 := exec.Command("net", "start", fmt.Sprintf("WireGuardTunnel$%s", m.iface)).CombinedOutput()
	if err2 != nil {
		return fmt.Errorf("failed to start WireGuard tunnel on Windows: %s: %w", string(o2), err2)
	}
	return nil
}

// Stop brings down the WireGuard tunnel on Windows.
func (m *Manager) Stop() error {
	out, err := exec.Command("net", "stop", fmt.Sprintf("WireGuardTunnel$%s", m.iface)).CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to stop WireGuard tunnel on Windows: %s: %w", string(out), err)
	}
	return nil
}

// Restart restarts the WireGuard tunnel on Windows.
func (m *Manager) Restart() error {
	if m.IsRunning() {
		if err := m.Stop(); err != nil {
			return err
		}
	}
	return m.Start()
}

// Reload applies config changes. On Windows we restart the tunnel since syncconf via /dev/stdin
// is not available.
func (m *Manager) Reload(_ *ServerConf) error {
	return m.Restart()
}

// GetConnectedPeers parses `wg show dump` on Windows.
func (m *Manager) GetConnectedPeers() ([]ConnectedPeer, error) {
	out, err := exec.Command("wg", "show", m.iface, "dump").CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("wg show dump failed: %s: %w", string(out), err)
	}
	return parseDump(string(out))
}

// DisconnectPeer removes a peer from the live WireGuard interface.
func (m *Manager) DisconnectPeer(publicKey string) error {
	out, err := exec.Command("wg", "set", m.iface, "peer", publicKey, "remove").CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to remove peer: %s: %w", string(out), err)
	}
	return nil
}

// GetStatus returns a brief status string.
func (m *Manager) GetStatus() (string, error) {
	out, err := exec.Command("wg", "show", m.iface).CombinedOutput()
	if err != nil {
		return "", nil
	}
	return string(out), nil
}

// GetSystemdStatus is not applicable on Windows — returns "n/a".
func (m *Manager) GetSystemdStatus() (string, error) {
	return "n/a", nil
}

// EnableSystemd is not applicable on Windows.
func (m *Manager) EnableSystemd() error {
	return fmt.Errorf("systemd is not available on Windows — use the WireGuard service manager")
}

// DisableSystemd is not applicable on Windows.
func (m *Manager) DisableSystemd() error {
	return fmt.Errorf("systemd is not available on Windows — use the WireGuard service manager")
}
