package api

import (
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type systemLogEntry struct {
	Timestamp string `json:"timestamp"`
	Service   string `json:"service"`
	Unit      string `json:"unit"`
	Message   string `json:"message"`
}

// GetSystemLogs returns recent journal entries for WireGate and WireGuard.
// GET /api/system/logs
func (h *Handler) GetSystemLogs(c *gin.Context) {
	if runtime.GOOS != "linux" {
		c.JSON(http.StatusOK, gin.H{
			"supported": false,
			"error":     "system logs endpoint is only supported on Linux",
			"entries":   []systemLogEntry{},
		})
		return
	}

	if _, err := exec.LookPath("journalctl"); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"supported": false,
			"error":     "journalctl not found on system",
			"entries":   []systemLogEntry{},
		})
		return
	}

	lines := 200
	if raw := strings.TrimSpace(c.Query("lines")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			lines = parsed
		}
	}
	if lines < 50 {
		lines = 50
	}
	if lines > 1000 {
		lines = 1000
	}

	iface := strings.TrimSpace(os.Getenv("WIREGATE_WIREGUARD_INTERFACE"))
	if iface == "" {
		iface = "wg0"
	}

	availableUnits := map[string]string{
		"wiregate":  "wiregate",
		"wireguard": "wg-quick@" + iface,
	}

	selectedServices := []string{"wiregate", "wireguard"}
	if raw := strings.TrimSpace(c.Query("services")); raw != "" {
		selectedServices = selectedServices[:0]
		seen := map[string]struct{}{}
		for _, part := range strings.Split(raw, ",") {
			service := strings.ToLower(strings.TrimSpace(part))
			if service == "" {
				continue
			}
			if _, ok := availableUnits[service]; !ok {
				continue
			}
			if _, exists := seen[service]; exists {
				continue
			}
			seen[service] = struct{}{}
			selectedServices = append(selectedServices, service)
		}
		if len(selectedServices) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "services must include wiregate and/or wireguard"})
			return
		}
	}

	units := make([]string, 0, len(selectedServices))
	for _, service := range selectedServices {
		units = append(units, availableUnits[service])
	}

	args := []string{"--no-pager", "--output=short-iso", "-n", strconv.Itoa(lines)}
	for _, unit := range units {
		args = append(args, "-u", unit)
	}

	out, err := exec.Command("journalctl", args...).CombinedOutput()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "failed to read journal logs",
			"details": strings.TrimSpace(string(out)),
		})
		return
	}

	entries := parseJournalEntries(string(out), units)

	c.JSON(http.StatusOK, gin.H{
		"supported":    true,
		"services":     selectedServices,
		"units":        units,
		"lines":        lines,
		"generated_at": time.Now().UTC().Format(time.RFC3339),
		"entries":      entries,
	})
}

func parseJournalEntries(raw string, requestedUnits []string) []systemLogEntry {
	unitSet := make(map[string]struct{}, len(requestedUnits))
	for _, unit := range requestedUnits {
		unitSet[unit] = struct{}{}
	}

	entries := make([]systemLogEntry, 0)
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		parts := strings.SplitN(line, " ", 3)
		if len(parts) < 3 {
			continue
		}

		timestamp := parts[0]
		rest := parts[2]

		unitAndMessage := strings.SplitN(rest, ": ", 2)
		if len(unitAndMessage) != 2 {
			continue
		}

		rawUnit := unitAndMessage[0]
		message := unitAndMessage[1]

		unit := rawUnit
		if idx := strings.Index(unit, "["); idx > 0 {
			unit = unit[:idx]
		}

		if len(unitSet) > 0 {
			if _, ok := unitSet[unit]; !ok {
				continue
			}
		}

		service := "wiregate"
		if strings.HasPrefix(unit, "wg-quick@") {
			service = "wireguard"
		}

		entries = append(entries, systemLogEntry{
			Timestamp: timestamp,
			Service:   service,
			Unit:      unit,
			Message:   message,
		})
	}

	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].Timestamp < entries[j].Timestamp
	})

	return entries
}
