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
	Source    string `json:"source"`
	Message   string `json:"message"`
}

// GetSystemLogs returns recent journal entries for WireGate and WireGuard.
// GET /api/system/logs
func (h *Handler) GetSystemLogs(c *gin.Context) {
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
		"traffic":   "",
	}

	selectedServices := []string{"wiregate", "wireguard", "traffic"}
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
			c.JSON(http.StatusBadRequest, gin.H{"error": "services must include wiregate, wireguard, and/or traffic"})
			return
		}
	}

	units := make([]string, 0, len(selectedServices))
	for _, service := range selectedServices {
		if unit := availableUnits[service]; unit != "" {
			units = append(units, unit)
		}
	}
	entries := make([]systemLogEntry, 0)
	warnings := make([]string, 0)
	journalAvailable := runtime.GOOS == "linux"

	if journalAvailable {
		if _, err := exec.LookPath("journalctl"); err != nil {
			journalAvailable = false
			warnings = append(warnings, "journalctl not found; using process logs when available")
		}
	} else {
		warnings = append(warnings, "journald logs are only available on Linux")
	}

	for _, service := range selectedServices {
		if service == "traffic" {
			entries = append(entries, snapshotTrafficLogs(lines)...)
			continue
		}

		unit := availableUnits[service]

		if journalAvailable {
			serviceEntries, jWarn := readJournalUnit(service, unit, lines)
			if jWarn != "" {
				warnings = append(warnings, jWarn)
			}
			entries = append(entries, serviceEntries...)
		}

		if service == "wiregate" && (isDevModeEnv() || !journalAvailable || countServiceEntries(entries, "wiregate") == 0) {
			for _, item := range defaultProcessLogs.snapshot(lines) {
				entries = append(entries, systemLogEntry{
					Timestamp: item.Timestamp.Format(time.RFC3339),
					Service:   "wiregate",
					Unit:      "wiregate-process",
					Source:    "process",
					Message:   item.Message,
				})
			}
		}
	}

	if len(entries) == 0 && len(warnings) == 0 {
		warnings = append(warnings, "no logs available for selected services")
	}

	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].Timestamp < entries[j].Timestamp
	})

	c.JSON(http.StatusOK, gin.H{
		"supported":    len(entries) > 0 || journalAvailable,
		"services":     selectedServices,
		"units":        units,
		"lines":        lines,
		"generated_at": time.Now().UTC().Format(time.RFC3339),
		"warnings":     warnings,
		"entries":      entries,
	})
}

func readJournalUnit(service, unit string, lines int) ([]systemLogEntry, string) {
	args := []string{"--no-pager", "--output=short-iso", "-n", strconv.Itoa(lines), "-u", unit}
	out, err := exec.Command("journalctl", args...).CombinedOutput()
	text := strings.TrimSpace(string(out))

	if err != nil {
		if strings.Contains(text, "No entries") || strings.Contains(text, "No journal files") {
			return []systemLogEntry{}, ""
		}
		return []systemLogEntry{}, "journal read failed for " + unit + ": " + text
	}

	entries := parseJournalEntries(string(out), []string{unit})
	for i := range entries {
		entries[i].Service = service
		entries[i].Source = "journal"
	}

	return entries, ""
}

func countServiceEntries(entries []systemLogEntry, service string) int {
	count := 0
	for _, entry := range entries {
		if entry.Service == service {
			count++
		}
	}
	return count
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
			Source:    "journal",
			Message:   message,
		})
	}

	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].Timestamp < entries[j].Timestamp
	})

	return entries
}
