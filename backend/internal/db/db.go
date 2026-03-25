package db

import (
	"fmt"

	"github.com/basmulder03/wiregate/internal/config"
	"github.com/basmulder03/wiregate/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Database is the interface all DB backends must implement.
// Currently only SQLite is implemented, but this interface allows
// future support for PostgreSQL, MySQL, etc.
type Database interface {
	GetDB() *gorm.DB
	AutoMigrate() error
	Close() error
}

// sqliteDB is the SQLite implementation
type sqliteDB struct {
	db *gorm.DB
}

// New creates a new database connection based on configuration.
func New(cfg *config.DatabaseConfig) (Database, error) {
	switch cfg.Driver {
	case "sqlite", "":
		return newSQLite(cfg.DSN)
	default:
		return nil, fmt.Errorf("unsupported database driver: %s", cfg.Driver)
	}
}

func openGorm(dialector gorm.Dialector) (*sqliteDB, error) {
	db, err := gorm.Open(dialector, &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return nil, err
	}
	db.Exec("PRAGMA journal_mode=WAL;")
	db.Exec("PRAGMA foreign_keys=ON;")
	return &sqliteDB{db: db}, nil
}

func (s *sqliteDB) GetDB() *gorm.DB { return s.db }

func (s *sqliteDB) AutoMigrate() error {
	return s.db.AutoMigrate(
		&models.User{},
		&models.APIKey{},
		&models.WireGuardServer{},
		&models.Client{},
		&models.AuditLog{},
		&models.OIDCConfig{},
		&models.SystemSettings{},
	)
}

func (s *sqliteDB) Close() error {
	sqlDB, err := s.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}
