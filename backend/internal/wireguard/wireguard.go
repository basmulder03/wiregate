package wireguard

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"text/template"

	"golang.org/x/crypto/curve25519"
)

const wgConfTemplate = `[Interface]
PrivateKey = {{ .PrivateKey }}
Address = {{ .Address }}
ListenPort = {{ .ListenPort }}
{{ if .DNS }}DNS = {{ .DNS }}{{ end }}
{{ if .MTU }}MTU = {{ .MTU }}{{ end }}
{{ if .PostUp }}PostUp = {{ .PostUp }}{{ end }}
{{ if .PostDown }}PostDown = {{ .PostDown }}{{ end }}

{{ range .Peers }}
[Peer]
PublicKey = {{ .PublicKey }}
{{ if .PresharedKey }}PresharedKey = {{ .PresharedKey }}{{ end }}
AllowedIPs = {{ .AllowedIPs }}
{{ if .Endpoint }}Endpoint = {{ .Endpoint }}{{ end }}
{{ end }}`

const clientConfTemplate = `[Interface]
PrivateKey = {{ .PrivateKey }}
Address = {{ .Address }}
{{ if .DNS }}DNS = {{ .DNS }}{{ end }}
{{ if .MTU }}MTU = {{ .MTU }}{{ end }}

[Peer]
PublicKey = {{ .ServerPublicKey }}
{{ if .PresharedKey }}PresharedKey = {{ .PresharedKey }}{{ end }}
AllowedIPs = {{ .AllowedIPs }}
Endpoint = {{ .Endpoint }}
PersistentKeepalive = 25
`

// ServerConf is the data for wg config file generation
type ServerConf struct {
	PrivateKey string
	Address    string
	ListenPort int
	DNS        string
	MTU        int
	PostUp     string
	PostDown   string
	Peers      []PeerConf
}

// PeerConf represents a peer entry in a server config
type PeerConf struct {
	PublicKey    string
	PresharedKey string
	AllowedIPs   string
	Endpoint     string
}

// ClientConf is the data for generating a client config file
type ClientConf struct {
	PrivateKey      string
	Address         string
	DNS             string
	MTU             int
	ServerPublicKey string
	PresharedKey    string
	AllowedIPs      string
	Endpoint        string
}

// Manager handles WireGuard operations
type Manager struct {
	configDir string
	iface     string
}

// NewManager creates a new WireGuard manager
func NewManager(configDir, iface string) *Manager {
	return &Manager{
		configDir: configDir,
		iface:     iface,
	}
}

// WriteConfig writes the WireGuard server config file
func (m *Manager) WriteConfig(conf *ServerConf) error {
	if err := os.MkdirAll(m.configDir, 0700); err != nil {
		return fmt.Errorf("failed to create config dir: %w", err)
	}
	confPath := filepath.Join(m.configDir, m.iface+".conf")

	tmpl, err := template.New("wg").Parse(wgConfTemplate)
	if err != nil {
		return err
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, conf); err != nil {
		return err
	}

	return os.WriteFile(confPath, buf.Bytes(), 0600)
}

// GenerateClientConfig generates a client config string
func GenerateClientConfig(conf *ClientConf) (string, error) {
	tmpl, err := template.New("client").Parse(clientConfTemplate)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, conf); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// GenerateKeyPair generates a new WireGuard private/public key pair
func GenerateKeyPair() (privateKey, publicKey string, err error) {
	var privKey [32]byte
	if _, err = rand.Read(privKey[:]); err != nil {
		return
	}
	// WireGuard clamping
	privKey[0] &= 248
	privKey[31] = (privKey[31] & 127) | 64

	var pubKey [32]byte
	curve25519.ScalarBaseMult(&pubKey, &privKey)

	privateKey = base64.StdEncoding.EncodeToString(privKey[:])
	publicKey = base64.StdEncoding.EncodeToString(pubKey[:])
	return
}

// GeneratePresharedKey generates a random 32-byte preshared key
func GeneratePresharedKey() (string, error) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(key), nil
}

// GetNextAvailableIP returns the next available IP in a subnet
func GetNextAvailableIP(subnet string, usedIPs []string) (string, error) {
	_, network, err := net.ParseCIDR(subnet)
	if err != nil {
		return "", fmt.Errorf("invalid subnet: %w", err)
	}

	used := make(map[string]bool)
	for _, ip := range usedIPs {
		// Strip CIDR notation if present
		addr := strings.Split(ip, "/")[0]
		used[addr] = true
	}

	// Start from .2 (server is .1)
	ip := network.IP
	for i := range ip {
		ip[i] = network.IP[i]
	}
	incrementIP(ip)
	incrementIP(ip) // skip .1 (server)

	for network.Contains(ip) {
		ipStr := ip.String()
		if !used[ipStr] {
			return ipStr + "/32", nil
		}
		incrementIP(ip)
	}
	return "", fmt.Errorf("no available IPs in subnet %s", subnet)
}

func incrementIP(ip net.IP) {
	for i := len(ip) - 1; i >= 0; i-- {
		ip[i]++
		if ip[i] != 0 {
			break
		}
	}
}

// ConnectedPeer holds live connection info from `wg show`
type ConnectedPeer struct {
	PublicKey       string
	Endpoint        string
	AllowedIPs      string
	LatestHandshake string
	TransferRx      int64
	TransferTx      int64
}

func generateStrippedConf(conf *ServerConf) (string, error) {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("[Interface]\nPrivateKey = %s\nListenPort = %d\n", conf.PrivateKey, conf.ListenPort))
	for _, peer := range conf.Peers {
		sb.WriteString(fmt.Sprintf("\n[Peer]\nPublicKey = %s\nAllowedIPs = %s\n", peer.PublicKey, peer.AllowedIPs))
		if peer.PresharedKey != "" {
			sb.WriteString(fmt.Sprintf("PresharedKey = %s\n", peer.PresharedKey))
		}
	}
	return sb.String(), nil
}

func parseDump(dump string) ([]ConnectedPeer, error) {
	var peers []ConnectedPeer
	lines := strings.Split(strings.TrimSpace(dump), "\n")
	// First line is the interface itself, skip it
	for _, line := range lines[1:] {
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 8 {
			continue
		}
		var rxBytes, txBytes int64
		fmt.Sscanf(fields[5], "%d", &rxBytes)
		fmt.Sscanf(fields[6], "%d", &txBytes)

		peer := ConnectedPeer{
			PublicKey:       fields[0],
			Endpoint:        fields[2],
			AllowedIPs:      fields[3],
			LatestHandshake: fields[4],
			TransferRx:      rxBytes,
			TransferTx:      txBytes,
		}
		if peer.Endpoint == "(none)" {
			peer.Endpoint = ""
		}
		peers = append(peers, peer)
	}
	return peers, nil
}
