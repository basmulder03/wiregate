//go:build cgo

package db

import (
	"fmt"

	gormsqlite "gorm.io/driver/sqlite"
)

// newSQLite opens an SQLite database using the CGO-backed mattn/go-sqlite3 driver.
// This is the default on Linux and Windows where CGO is available.
func newSQLite(dsn string) (*sqliteDB, error) {
	db, err := openGorm(gormsqlite.Open(dsn))
	if err != nil {
		return nil, fmt.Errorf("failed to open SQLite database at %s: %w", dsn, err)
	}
	return db, nil
}
