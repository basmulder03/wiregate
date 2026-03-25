package middleware

import (
	"net"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// CIDRAllowList only allows requests from the configured CIDR ranges.
func CIDRAllowList(allowedCIDRs []string) gin.HandlerFunc {
	networks := make([]*net.IPNet, 0, len(allowedCIDRs))
	for _, raw := range allowedCIDRs {
		cidr := strings.TrimSpace(raw)
		if cidr == "" {
			continue
		}
		_, ipNet, err := net.ParseCIDR(cidr)
		if err != nil {
			continue
		}
		networks = append(networks, ipNet)
	}

	return func(c *gin.Context) {
		if len(networks) == 0 {
			c.Next()
			return
		}

		remoteIP := requestIP(c.Request)
		if remoteIP == nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "access denied"})
			return
		}

		for _, network := range networks {
			if network.Contains(remoteIP) {
				c.Next()
				return
			}
		}

		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "access denied"})
	}
}

func requestIP(r *http.Request) net.IP {
	if r == nil {
		return nil
	}

	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil {
		ip := net.ParseIP(host)
		if ip != nil {
			return ip
		}
	}

	return net.ParseIP(strings.TrimSpace(r.RemoteAddr))
}
