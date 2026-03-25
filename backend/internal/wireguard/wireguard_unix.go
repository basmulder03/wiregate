//go:build !windows

package wireguard

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// IsInstalled checks if WireGuard tools are available on the system.
func IsInstalled() bool {
	_, errWg := exec.LookPath("wg")
	_, errWgQuick := exec.LookPath("wg-quick")
	return errWg == nil && errWgQuick == nil
}

// InstallWireGuard attempts to install WireGuard using the platform package manager.
// It returns an error if installation fails or the platform is unsupported.
func InstallWireGuard() error {
	switch runtime.GOOS {
	case "linux":
		return installWireGuardLinux()
	case "darwin":
		return installWireGuardDarwin()
	default:
		return fmt.Errorf("auto-install not supported on %s — please install WireGuard manually", runtime.GOOS)
	}
}

func installWireGuardLinux() error {
	// Try the most common package managers in order.
	type pm struct {
		check   string
		install []string
	}
	managers := []pm{
		{"apt-get", []string{"apt-get", "install", "-y", "wireguard"}},
		{"dnf", []string{"dnf", "install", "-y", "wireguard-tools"}},
		{"yum", []string{"yum", "install", "-y", "wireguard-tools"}},
		{"zypper", []string{"zypper", "--non-interactive", "install", "wireguard-tools"}},
		{"pacman", []string{"pacman", "-Sy", "--noconfirm", "wireguard-tools"}},
		{"apk", []string{"apk", "add", "--no-cache", "wireguard-tools"}},
	}
	for _, m := range managers {
		if _, err := exec.LookPath(m.check); err == nil {
			log.Printf("wireguard: installing via %s", m.check)
			out, err := exec.Command(m.install[0], m.install[1:]...).CombinedOutput()
			if err != nil {
				return fmt.Errorf("%s install failed: %s: %w", m.check, string(out), err)
			}
			return nil
		}
	}
	return fmt.Errorf("no supported package manager found — install wireguard-tools manually")
}

func installWireGuardDarwin() error {
	// Homebrew is the standard way on macOS.
	if _, err := exec.LookPath("brew"); err != nil {
		return fmt.Errorf("Homebrew not found — install it from https://brew.sh then run: brew install wireguard-tools")
	}
	log.Println("wireguard: installing via brew")
	out, err := exec.Command("brew", "install", "wireguard-tools").CombinedOutput()
	if err != nil {
		return fmt.Errorf("brew install wireguard-tools failed: %s: %w", string(out), err)
	}
	return nil
}

func runCommand(name string, args ...string) *exec.Cmd {
	if isDevMode() {
		return exec.Command("sudo", append([]string{"-n", name}, args...)...)
	}
	return exec.Command(name, args...)
}

// IsRunning checks if the WireGuard interface is up.
func (m *Manager) IsRunning() bool {
	return runCommand("wg", "show", m.iface).Run() == nil
}

// Start brings up the WireGuard interface.
func (m *Manager) Start() error {
	if m.IsRunning() {
		return nil
	}

	confPath := filepath.Join(m.configDir, m.iface+".conf")
	if _, err := os.Stat(confPath); os.IsNotExist(err) {
		return fmt.Errorf("config file not found: %s", confPath)
	}
	out, err := runCommand("wg-quick", "up", confPath).CombinedOutput()
	if err != nil {
		if strings.Contains(string(out), "already exists") {
			if isDevMode() {
				if downOut, downErr := runCommand("wg-quick", "down", confPath).CombinedOutput(); downErr != nil {
					return fmt.Errorf("failed to reset dev WireGuard interface: %s: %w", string(downOut), downErr)
				}
				retryOut, retryErr := runCommand("wg-quick", "up", confPath).CombinedOutput()
				if retryErr != nil {
					return fmt.Errorf("failed to start WireGuard after dev reset: %s: %w", string(retryOut), retryErr)
				}
				return nil
			}
			return nil
		}
		return fmt.Errorf("failed to start WireGuard: %s: %w", string(out), err)
	}
	return nil
}

func isDevMode() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("WIREGATE_DEV_MODE")))
	return value == "1" || value == "true" || value == "yes"
}

// Stop brings down the WireGuard interface.
func (m *Manager) Stop() error {
	confPath := filepath.Join(m.configDir, m.iface+".conf")
	out, err := runCommand("wg-quick", "down", confPath).CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to stop WireGuard: %s: %w", string(out), err)
	}
	return nil
}

// Restart restarts the WireGuard interface.
func (m *Manager) Restart() error {
	if m.IsRunning() {
		if err := m.Stop(); err != nil {
			return err
		}
	}
	return m.Start()
}

// Reload applies config changes without dropping connections (wg syncconf).
func (m *Manager) Reload(conf *ServerConf) error {
	stripped, err := generateStrippedConf(conf)
	if err != nil {
		return err
	}
	cmd := runCommand("wg", "syncconf", m.iface, "/dev/stdin")
	cmd.Stdin = strings.NewReader(stripped)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("wg syncconf failed: %s: %w", string(out), err)
	}
	return nil
}

// GetConnectedPeers parses `wg show dump` output for live connection data.
func (m *Manager) GetConnectedPeers() ([]ConnectedPeer, error) {
	out, err := runCommand("wg", "show", m.iface, "dump").CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("wg show dump failed: %s: %w", string(out), err)
	}
	return parseDump(string(out))
}

// DisconnectPeer removes a peer from the live WireGuard interface.
func (m *Manager) DisconnectPeer(publicKey string) error {
	out, err := runCommand("wg", "set", m.iface, "peer", publicKey, "remove").CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to remove peer: %s: %w", string(out), err)
	}
	return nil
}

// GetStatus returns the WireGuard interface status string.
func (m *Manager) GetStatus() (string, error) {
	out, err := runCommand("wg", "show", m.iface).CombinedOutput()
	if err != nil {
		return "", nil // Not running
	}
	return string(out), nil
}

// GetSystemdStatus returns systemd service status (Linux only; returns "n/a" on macOS).
func (m *Manager) GetSystemdStatus() (string, error) {
	if runtime.GOOS != "linux" {
		return "n/a", nil
	}
	out, err := exec.Command("systemctl", "is-active", fmt.Sprintf("wg-quick@%s", m.iface)).CombinedOutput()
	if err != nil {
		return strings.TrimSpace(string(out)), nil
	}
	return strings.TrimSpace(string(out)), nil
}

// EnableSystemd enables the WireGuard service to start on boot (Linux only).
func (m *Manager) EnableSystemd() error {
	if runtime.GOOS != "linux" {
		return fmt.Errorf("systemd is only available on Linux")
	}
	out, err := exec.Command("systemctl", "enable", fmt.Sprintf("wg-quick@%s", m.iface)).CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl enable failed: %s: %w", string(out), err)
	}
	return nil
}

// DisableSystemd disables WireGuard from starting on boot (Linux only).
func (m *Manager) DisableSystemd() error {
	if runtime.GOOS != "linux" {
		return fmt.Errorf("systemd is only available on Linux")
	}
	out, err := exec.Command("systemctl", "disable", fmt.Sprintf("wg-quick@%s", m.iface)).CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl disable failed: %s: %w", string(out), err)
	}
	return nil
}
