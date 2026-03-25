// Package static embeds the compiled frontend assets into the binary.
//
// Before building the Go binary, the frontend must be compiled and its
// output copied into the backend/ui/ directory:
//
//	cd frontend && pnpm build
//	cp -r frontend/dist/. backend/ui/
//
// The Makefile 'build' target does this automatically.
// In development (make dev-backend), set WIREGATE_SERVER_STATIC_DIR to serve
// from disk instead of the embedded FS.
package static

import (
	"embed"
	"io/fs"
)

//go:embed all:ui
var embedded embed.FS

// FS returns a sub-filesystem rooted at the embedded 'ui/' directory,
// ready to be served by http.FileServer.
// Returns nil if no real assets have been embedded (only the .gitkeep placeholder).
func FS() fs.FS {
	sub, err := fs.Sub(embedded, "ui")
	if err != nil {
		return nil
	}
	// Check whether real assets exist (more than just .gitkeep)
	entries, err := fs.ReadDir(sub, ".")
	if err != nil || len(entries) == 0 {
		return nil
	}
	for _, e := range entries {
		if e.Name() != ".gitkeep" {
			return sub
		}
	}
	// Only .gitkeep present — no built frontend assets embedded
	return nil
}
