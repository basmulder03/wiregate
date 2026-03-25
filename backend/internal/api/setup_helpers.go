package api

import (
	"context"
	"fmt"
	"net"
	"net/netip"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/basmulder03/wiregate/internal/models"
	"github.com/gin-gonic/gin"
)

func (h *Handler) isServerConfigured() bool {
	var server models.WireGuardServer
	if err := h.db.First(&server).Error; err != nil {
		return false
	}

	return strings.TrimSpace(server.Address) != "" &&
		strings.TrimSpace(server.PrivateKey) != "" &&
		strings.TrimSpace(server.PublicKey) != ""
}

// GetSetupDefaults returns best-effort setup defaults based on host networking.
// GET /api/setup/defaults
func (h *Handler) GetSetupDefaults(c *gin.Context) {
	devMode := isDevModeEnv()
	mode := "production"
	if devMode {
		mode = "development"
	}

	detectedCIDRs, usedNets, detectedIPs := detectHostIPv4Networks()
	systemResolvers := detectSystemResolvers()
	defaultSourceIP, defaultEgressIface := detectDefaultRouteInfo()

	address := pickSuggestedAddress(usedNets, devMode)
	dns := pickSuggestedDNS(systemResolvers, devMode)
	listenPort := 51820
	if devMode {
		listenPort = 51821
	}
	iface := strings.TrimSpace(os.Getenv("WIREGATE_WIREGUARD_INTERFACE"))
	if iface == "" {
		iface = "wg0"
	}
	if defaultEgressIface == "" {
		defaultEgressIface = "eth0"
	}
	endpoint := pickSuggestedEndpoint(detectedIPs, defaultSourceIP, address, listenPort, devMode)
	postUp := buildDefaultPostUp(defaultEgressIface)
	postDown := buildDefaultPostDown(defaultEgressIface)

	var existing models.WireGuardServer
	if err := h.db.First(&existing).Error; err == nil {
		if strings.TrimSpace(existing.Interface) != "" {
			iface = existing.Interface
		}
		if strings.TrimSpace(existing.Address) != "" {
			address = existing.Address
		}
		if strings.TrimSpace(existing.DNS) != "" {
			dns = existing.DNS
		}
		if existing.ListenPort > 0 {
			listenPort = existing.ListenPort
		}
		if strings.TrimSpace(existing.PostUp) != "" {
			postUp = existing.PostUp
		}
		if strings.TrimSpace(existing.PostDown) != "" {
			postDown = existing.PostDown
		}
	}

	if savedEndpoint := h.getSavedPublicEndpoint(); savedEndpoint != "" {
		endpoint = savedEndpoint
	}

	c.JSON(200, gin.H{
		"mode":                mode,
		"interface":           iface,
		"address":             address,
		"listen_port":         listenPort,
		"dns":                 dns,
		"endpoint":            endpoint,
		"egress_interface":    defaultEgressIface,
		"post_up":             postUp,
		"post_down":           postDown,
		"detected_ipv4_cidrs": detectedCIDRs,
		"detected_ipv4_ips":   detectedIPs,
		"default_source_ip":   defaultSourceIP,
		"detected_dns":        systemResolvers,
	})
}

func (h *Handler) getSavedPublicEndpoint() string {
	var setting models.SystemSettings
	if err := h.db.Where("key = ?", "server_public_endpoint").First(&setting).Error; err != nil {
		return ""
	}
	return strings.TrimSpace(setting.Value)
}

// CheckSetupDNS checks whether the provided DNS servers can resolve names.
// POST /api/setup/dns/check
func (h *Handler) CheckSetupDNS(c *gin.Context) {
	var req struct {
		DNS        string `json:"dns" binding:"required"`
		TestDomain string `json:"test_domain"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	testDomain := strings.TrimSpace(req.TestDomain)
	if testDomain == "" {
		testDomain = "example.com"
	}

	servers := parseDNSServers(req.DNS)
	if len(servers) == 0 {
		c.JSON(400, gin.H{"error": "no valid DNS servers provided"})
		return
	}

	results := make([]gin.H, 0, len(servers))
	anyReachable := false

	for _, server := range servers {
		serverHostPort, serverHost, err := normalizeDNSServer(server)
		if err != nil {
			results = append(results, gin.H{
				"resolver":  server,
				"reachable": false,
				"error":     err.Error(),
			})
			continue
		}

		start := time.Now()
		ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
		resolvedIPs, lookupErr := lookupHostViaResolver(ctx, serverHostPort, testDomain)
		cancel()

		entry := gin.H{
			"resolver":      serverHost,
			"reachable":     lookupErr == nil,
			"latency_ms":    time.Since(start).Milliseconds(),
			"resolver_type": classifyAddress(serverHost),
		}

		if ptr := reverseLookup(serverHost); ptr != "" {
			entry["resolver_ptr"] = ptr
		}

		if lookupErr != nil {
			entry["error"] = lookupErr.Error()
		} else {
			anyReachable = true
			if len(resolvedIPs) > 0 {
				entry["resolved_ips"] = resolvedIPs
			}
		}

		results = append(results, entry)
	}

	c.JSON(200, gin.H{
		"dns":           req.DNS,
		"test_domain":   testDomain,
		"available":     anyReachable,
		"resolver_info": results,
	})
}

func isDevModeEnv() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("WIREGATE_DEV_MODE")))
	return value == "1" || value == "true" || value == "yes"
}

func detectHostIPv4Networks() ([]string, []*net.IPNet, []string) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil, nil, nil
	}

	seenCIDRs := map[string]struct{}{}
	seenIPs := map[string]struct{}{}
	usedNets := make([]*net.IPNet, 0)
	cidrs := make([]string, 0)
	ips := make([]string, 0)

	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipNet.IP.To4()
			if ip == nil || ip.IsLoopback() {
				continue
			}

			ones, _ := ipNet.Mask.Size()
			cidr := fmt.Sprintf("%s/%d", ip.String(), ones)
			if _, exists := seenCIDRs[cidr]; !exists {
				seenCIDRs[cidr] = struct{}{}
				cidrs = append(cidrs, cidr)
			}
			if _, exists := seenIPs[ip.String()]; !exists {
				seenIPs[ip.String()] = struct{}{}
				ips = append(ips, ip.String())
			}

			netCopy := &net.IPNet{IP: ip.Mask(ipNet.Mask), Mask: ipNet.Mask}
			usedNets = append(usedNets, netCopy)
		}
	}

	sort.Strings(cidrs)
	sort.SliceStable(ips, func(i, j int) bool {
		a := classifyAddress(ips[i])
		b := classifyAddress(ips[j])
		if a != b {
			order := map[string]int{"public": 0, "private": 1, "link-local": 2, "loopback": 3, "unknown": 4}
			return order[a] < order[b]
		}
		return ips[i] < ips[j]
	})

	return cidrs, usedNets, ips
}

func pickSuggestedEndpoint(detectedIPs []string, preferredIP, serverCIDR string, listenPort int, devMode bool) string {
	if listenPort <= 0 {
		listenPort = 51820
	}

	if preferredIP = strings.TrimSpace(preferredIP); preferredIP != "" {
		if net.ParseIP(preferredIP) != nil && !isIPInCIDR(preferredIP, serverCIDR) {
			return net.JoinHostPort(preferredIP, strconv.Itoa(listenPort))
		}
	}

	selectedIP := ""
	if devMode {
		for _, ip := range detectedIPs {
			if classifyAddress(ip) == "private" && !isIPInCIDR(ip, serverCIDR) {
				selectedIP = ip
				break
			}
		}
	}

	if selectedIP == "" {
		for _, ip := range detectedIPs {
			if classifyAddress(ip) == "public" && !isIPInCIDR(ip, serverCIDR) {
				selectedIP = ip
				break
			}
		}
	}

	if selectedIP == "" {
		for _, ip := range detectedIPs {
			if classifyAddress(ip) == "private" && !isIPInCIDR(ip, serverCIDR) {
				selectedIP = ip
				break
			}
		}
	}

	if selectedIP == "" {
		return ""
	}

	return net.JoinHostPort(selectedIP, strconv.Itoa(listenPort))
}

func buildDefaultPostUp(egressIface string) string {
	iface := strings.TrimSpace(egressIface)
	if iface == "" {
		iface = "eth0"
	}
	return "iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o " + iface + " -j MASQUERADE"
}

func buildDefaultPostDown(egressIface string) string {
	iface := strings.TrimSpace(egressIface)
	if iface == "" {
		iface = "eth0"
	}
	return "iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT; iptables -t nat -D POSTROUTING -o " + iface + " -j MASQUERADE"
}

func detectDefaultRouteInfo() (string, string) {
	conn, err := net.Dial("udp4", "1.1.1.1:53")
	if err != nil {
		return "", ""
	}
	defer conn.Close()

	udpAddr, ok := conn.LocalAddr().(*net.UDPAddr)
	if !ok || udpAddr.IP == nil {
		return "", ""
	}

	sourceIP := udpAddr.IP.To4()
	if sourceIP == nil {
		return "", ""
	}

	interfaceName := interfaceNameForIP(sourceIP.String())
	return sourceIP.String(), interfaceName
}

func interfaceNameForIP(ip string) string {
	interfaces, err := net.Interfaces()
	if err != nil {
		return ""
	}

	for _, iface := range interfaces {
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			netAddr, ok := addr.(*net.IPNet)
			if !ok || netAddr.IP.To4() == nil {
				continue
			}
			if netAddr.IP.String() == ip {
				return iface.Name
			}
		}
	}

	return ""
}

func isIPInCIDR(ip, cidr string) bool {
	parsedIP := net.ParseIP(strings.TrimSpace(ip))
	if parsedIP == nil {
		return false
	}

	_, network, err := net.ParseCIDR(strings.TrimSpace(cidr))
	if err != nil || network == nil {
		return false
	}

	return network.Contains(parsedIP)
}

func pickSuggestedAddress(usedNets []*net.IPNet, devMode bool) string {
	candidates := []string{"10.8.0.1/24", "10.9.0.1/24", "10.10.0.1/24", "10.44.0.1/24", "172.31.254.1/24"}
	if devMode {
		candidates = []string{"10.99.0.1/24", "10.100.0.1/24", "10.101.0.1/24", "10.66.0.1/24", "10.8.0.1/24"}
	}

	for _, candidate := range candidates {
		if !overlapsAny(candidate, usedNets) {
			return candidate
		}
	}

	if devMode {
		return "10.99.0.1/24"
	}
	return "10.8.0.1/24"
}

func overlapsAny(candidateCIDR string, usedNets []*net.IPNet) bool {
	_, candidate, err := net.ParseCIDR(candidateCIDR)
	if err != nil {
		return false
	}

	for _, used := range usedNets {
		if used == nil {
			continue
		}
		if ipv4NetsOverlap(candidate, used) {
			return true
		}
	}
	return false
}

func ipv4NetsOverlap(a, b *net.IPNet) bool {
	aStart, aEnd, okA := ipv4Range(a)
	bStart, bEnd, okB := ipv4Range(b)
	if !okA || !okB {
		return false
	}
	return aStart <= bEnd && bStart <= aEnd
}

func ipv4Range(ipNet *net.IPNet) (uint32, uint32, bool) {
	if ipNet == nil {
		return 0, 0, false
	}
	ip := ipNet.IP.To4()
	if ip == nil {
		return 0, 0, false
	}
	mask := net.IP(ipNet.Mask).To4()
	if mask == nil {
		return 0, 0, false
	}

	start := binaryIPv4ToUint32(ip.Mask(ipNet.Mask))
	maskU32 := binaryIPv4ToUint32(mask)
	end := start | (^maskU32)
	return start, end, true
}

func binaryIPv4ToUint32(ip net.IP) uint32 {
	v4 := ip.To4()
	if v4 == nil {
		return 0
	}
	return uint32(v4[0])<<24 | uint32(v4[1])<<16 | uint32(v4[2])<<8 | uint32(v4[3])
}

func detectSystemResolvers() []string {
	data, err := os.ReadFile("/etc/resolv.conf")
	if err != nil {
		return nil
	}

	seen := map[string]struct{}{}
	resolvers := make([]string, 0)

	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || !strings.HasPrefix(line, "nameserver") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		host := strings.TrimSpace(fields[1])
		if net.ParseIP(host) == nil {
			continue
		}
		if _, ok := seen[host]; ok {
			continue
		}
		seen[host] = struct{}{}
		resolvers = append(resolvers, host)
	}

	return resolvers
}

func pickSuggestedDNS(systemResolvers []string, devMode bool) string {
	if devMode {
		return "1.1.1.1, 1.0.0.1"
	}

	publicResolvers := make([]string, 0)
	for _, resolver := range systemResolvers {
		if classifyAddress(resolver) == "public" {
			publicResolvers = append(publicResolvers, resolver)
		}
	}

	if len(publicResolvers) >= 2 {
		return publicResolvers[0] + ", " + publicResolvers[1]
	}
	if len(publicResolvers) == 1 {
		return publicResolvers[0] + ", 1.1.1.1"
	}

	return "1.1.1.1, 8.8.8.8"
}

func parseDNSServers(value string) []string {
	parts := strings.FieldsFunc(value, func(r rune) bool {
		switch r {
		case ',', ';', '\n', '\t', ' ':
			return true
		default:
			return false
		}
	})

	servers := make([]string, 0, len(parts))
	seen := map[string]struct{}{}
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		servers = append(servers, trimmed)
	}
	return servers
}

func normalizeDNSServer(value string) (string, string, error) {
	v := strings.TrimSpace(value)
	if v == "" {
		return "", "", fmt.Errorf("empty resolver")
	}

	host := v
	port := "53"

	if strings.HasPrefix(v, "[") {
		h, p, err := net.SplitHostPort(v)
		if err != nil {
			return "", "", fmt.Errorf("invalid resolver %q", v)
		}
		host, port = h, p
	} else if strings.Count(v, ":") == 1 && strings.Contains(v, ".") {
		h, p, err := net.SplitHostPort(v)
		if err == nil {
			host, port = h, p
		}
	} else if strings.Count(v, ":") > 1 {
		if net.ParseIP(v) == nil {
			h, p, err := net.SplitHostPort(v)
			if err != nil {
				return "", "", fmt.Errorf("invalid resolver %q", v)
			}
			host, port = h, p
		}
	}

	if net.ParseIP(host) == nil {
		return "", "", fmt.Errorf("resolver %q is not a valid IP", host)
	}

	if port == "" {
		port = "53"
	}

	return net.JoinHostPort(host, port), host, nil
}

func lookupHostViaResolver(ctx context.Context, resolver, domain string) ([]string, error) {
	r := &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			d := &net.Dialer{Timeout: 2 * time.Second}
			return d.DialContext(ctx, network, resolver)
		},
	}

	ips, err := r.LookupHost(ctx, domain)
	if err != nil {
		return nil, err
	}

	if len(ips) > 6 {
		ips = ips[:6]
	}
	return ips, nil
}

func reverseLookup(host string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 1200*time.Millisecond)
	defer cancel()

	names, err := net.DefaultResolver.LookupAddr(ctx, host)
	if err != nil || len(names) == 0 {
		return ""
	}
	name := strings.TrimSuffix(strings.TrimSpace(names[0]), ".")
	return name
}

func classifyAddress(value string) string {
	addr, err := netip.ParseAddr(strings.TrimSpace(value))
	if err != nil {
		return "unknown"
	}
	if addr.IsLoopback() {
		return "loopback"
	}
	if addr.IsPrivate() {
		return "private"
	}
	if addr.IsLinkLocalUnicast() {
		return "link-local"
	}
	if addr.IsMulticast() {
		return "multicast"
	}
	if addr.IsUnspecified() {
		return "unspecified"
	}
	return "public"
}
