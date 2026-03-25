package api

import (
	"bytes"
	"io"
	"sync"
	"time"
)

type bufferedLogEntry struct {
	Timestamp time.Time
	Message   string
}

type processLogBuffer struct {
	mu      sync.RWMutex
	entries []bufferedLogEntry
	maxSize int
}

type processLogWriter struct {
	buffer *processLogBuffer
	carry  []byte
	mu     sync.Mutex
}

var defaultProcessLogs = &processLogBuffer{maxSize: 1500}

// ProcessLogWriter returns an io.Writer that stores recent log lines in memory.
func ProcessLogWriter() io.Writer {
	return &processLogWriter{buffer: defaultProcessLogs}
}

func (w *processLogWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	joined := append(w.carry, p...)
	parts := bytes.Split(joined, []byte{'\n'})
	if len(parts) == 0 {
		return len(p), nil
	}

	for i := 0; i < len(parts)-1; i++ {
		line := string(bytes.TrimSpace(parts[i]))
		if line == "" {
			continue
		}
		w.buffer.append(line)
	}

	w.carry = w.carry[:0]
	last := bytes.TrimSpace(parts[len(parts)-1])
	if len(last) > 0 {
		w.carry = append(w.carry, last...)
	}

	return len(p), nil
}

func (b *processLogBuffer) append(message string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.entries = append(b.entries, bufferedLogEntry{
		Timestamp: time.Now().UTC(),
		Message:   message,
	})

	if len(b.entries) > b.maxSize {
		drop := len(b.entries) - b.maxSize
		b.entries = b.entries[drop:]
	}
}

func (b *processLogBuffer) snapshot(limit int) []bufferedLogEntry {
	b.mu.RLock()
	defer b.mu.RUnlock()

	if limit <= 0 {
		limit = len(b.entries)
	}
	if limit > len(b.entries) {
		limit = len(b.entries)
	}
	start := len(b.entries) - limit
	if start < 0 {
		start = 0
	}

	out := make([]bufferedLogEntry, len(b.entries[start:]))
	copy(out, b.entries[start:])
	return out
}
