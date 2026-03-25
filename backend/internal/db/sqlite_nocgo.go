//go:build !cgo

package db

import (
	"fmt"

	gormsqlite "github.com/glebarez/sqlite"
)

// newSQLite opens an SQLite database using the pure-Go glebarez/sqlite driver
// (backed by modernc.org/sqlite). Used when CGO is disabled — e.g. when
// cross-compiling Darwin or Windows arm64 binaries from Linux.
func newSQLite(dsn string) (*sqliteDB, error) {
	db, err := openGorm(gormsqlite.Open(dsn))
	if err != nil {
		return nil, fmt.Errorf("failed to open SQLite database at %s: %w", dsn, err)
	}
	return db, nil
}
