package api

import (
	"sync"
	"time"
)

type trafficLogEntry struct {
	Timestamp time.Time
	Message   string
}

type trafficLogBuffer struct {
	mu      sync.RWMutex
	entries []trafficLogEntry
	maxSize int
}

var defaultTrafficLogs = &trafficLogBuffer{maxSize: 3000}

func appendTrafficLog(message string) {
	if message == "" {
		return
	}

	defaultTrafficLogs.mu.Lock()
	defer defaultTrafficLogs.mu.Unlock()

	defaultTrafficLogs.entries = append(defaultTrafficLogs.entries, trafficLogEntry{
		Timestamp: time.Now().UTC(),
		Message:   message,
	})

	if len(defaultTrafficLogs.entries) > defaultTrafficLogs.maxSize {
		drop := len(defaultTrafficLogs.entries) - defaultTrafficLogs.maxSize
		defaultTrafficLogs.entries = defaultTrafficLogs.entries[drop:]
	}
}

func snapshotTrafficLogs(limit int) []systemLogEntry {
	defaultTrafficLogs.mu.RLock()
	defer defaultTrafficLogs.mu.RUnlock()

	if limit <= 0 || limit > len(defaultTrafficLogs.entries) {
		limit = len(defaultTrafficLogs.entries)
	}
	start := len(defaultTrafficLogs.entries) - limit
	if start < 0 {
		start = 0
	}

	out := make([]systemLogEntry, 0, len(defaultTrafficLogs.entries[start:]))
	for _, entry := range defaultTrafficLogs.entries[start:] {
		out = append(out, systemLogEntry{
			Timestamp: entry.Timestamp.Format(time.RFC3339),
			Service:   "traffic",
			Unit:      "wireguard-traffic",
			Source:    "runtime",
			Message:   entry.Message,
		})
	}

	return out
}
