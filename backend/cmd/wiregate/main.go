package main

import (
	"fmt"
	"log"
	"os"

	"github.com/basmulder03/wiregate/internal/api"
	"github.com/basmulder03/wiregate/internal/auth"
	"github.com/basmulder03/wiregate/internal/config"
	"github.com/basmulder03/wiregate/internal/db"
	"github.com/basmulder03/wiregate/internal/static"
	"github.com/basmulder03/wiregate/internal/wireguard"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Ensure data directory exists; fall back to CWD on platforms where /var/lib isn't writable.
	dataDir := platformDataDir()
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		log.Printf("Warning: cannot create data dir %s, using current directory: %v", dataDir, err)
		dataDir = "."
	}

	// Only override the DSN default when the user hasn't explicitly set it via env/config.
	if cfg.Database.DSN == "/var/lib/wiregate/wiregate.db" {
		cfg.Database.DSN = dataDir + "/wiregate.db"
	}
	if cfg.Server.StaticDir == "/var/lib/wiregate/www" {
		cfg.Server.StaticDir = dataDir + "/www"
	}
	if cfg.WireGuard.ConfigDir == "/etc/wireguard" {
		cfg.WireGuard.ConfigDir = platformWireGuardDir()
	}

	// Initialize database
	database, err := db.New(&cfg.Database)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer database.Close()

	if err := database.AutoMigrate(); err != nil {
		log.Fatalf("Failed to run database migrations: %v", err)
	}

	gormDB := database.GetDB()

	// Initialize services
	authSvc := auth.NewService(gormDB, cfg.Server.JWTSecret, cfg.Server.JWTExpiry)
	wgMgr := wireguard.NewManager(cfg.WireGuard.ConfigDir, cfg.WireGuard.Interface)

	// WebSocket hub
	hub := api.NewHub()
	go hub.Run()
	hub.StartConnectionPoller(gormDB, wgMgr)

	// Background expiry enforcer
	handler := api.NewHandler(gormDB, authSvc, wgMgr, hub)
	handler.StartExpiryEnforcer()

	// Frontend assets: prefer disk staticDir (set by env/config or Docker), fall back to embedded.
	embeddedFS := static.FS()
	router := api.SetupRouter(handler, authSvc, cfg.Server.AllowedOrigins, cfg.Server.StaticDir, embeddedFS)

	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)

	log.Printf("WireGate starting on http://%s", addr)
	log.Printf("Database: %s (%s)", cfg.Database.Driver, cfg.Database.DSN)
	log.Printf("WireGuard interface: %s", cfg.WireGuard.Interface)

	if authSvc.IsSetupRequired() {
		log.Printf("No admin user found. Visit http://%s/setup to create one.", addr)
	}

	if cfg.Server.TLSEnabled {
		if err := router.RunTLS(addr, cfg.Server.TLSCertFile, cfg.Server.TLSKeyFile); err != nil {
			log.Fatalf("Failed to start TLS server: %v", err)
		}
	} else {
		if err := router.Run(addr); err != nil {
			log.Fatalf("Failed to start server: %v", err)
		}
	}
}
