package main

import (
	"fmt"
	"log"
	"os"

	"github.com/basmulder03/wiregate/internal/api"
	"github.com/basmulder03/wiregate/internal/auth"
	"github.com/basmulder03/wiregate/internal/config"
	"github.com/basmulder03/wiregate/internal/db"
	"github.com/basmulder03/wiregate/internal/wireguard"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Ensure data directory exists
	if err := os.MkdirAll("/var/lib/wiregate", 0755); err != nil {
		// Try local directory if /var/lib is not writable
		cfg.Database.DSN = "./wiregate.db"
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

	// API handler + router
	handler := api.NewHandler(gormDB, authSvc, wgMgr, hub)
	handler.StartExpiryEnforcer()
	router := api.SetupRouter(handler, authSvc, cfg.Server.AllowedOrigins, cfg.Server.StaticDir)

	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)

	log.Printf("WireGate starting on %s", addr)
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
