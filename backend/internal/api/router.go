package api

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/basmulder03/wiregate/internal/auth"
	"github.com/basmulder03/wiregate/internal/middleware"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

// SetupRouter creates and configures the Gin router
func SetupRouter(handler *Handler, authSvc *auth.Service, allowedOrigins []string, staticDir string) *gin.Engine {
	router := gin.New()
	router.Use(gin.Logger())
	router.Use(gin.Recovery())

	// CORS
	corsConfig := cors.DefaultConfig()
	corsConfig.AllowOrigins = allowedOrigins
	corsConfig.AllowHeaders = []string{
		"Origin", "Content-Type", "Accept",
		"Authorization", "X-Requested-With",
	}
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"}
	router.Use(cors.New(corsConfig))

	api := router.Group("/api")

	// Public routes
	public := api.Group("")
	{
		public.POST("/auth/login", handler.Login)
		public.POST("/auth/setup", handler.SetupAdmin)
		public.GET("/setup/status", handler.GetSetupStatus)
		// OIDC public endpoints
		public.GET("/auth/oidc/providers", handler.ListOIDCProviders)
		public.GET("/auth/oidc/:provider/login", handler.OIDCLoginURL)
		public.GET("/auth/oidc/:provider/callback", handler.OIDCCallback)
	}

	// WebSocket (auth validated inside for ws compatibility)
	api.GET("/ws", middleware.AuthMiddleware(authSvc), handler.ServeWS)

	// Protected routes
	protected := api.Group("")
	protected.Use(middleware.AuthMiddleware(authSvc))
	{
		// Auth
		auth := protected.Group("/auth")
		{
			auth.GET("/me", handler.GetCurrentUser)
			auth.POST("/totp/setup", handler.SetupTOTP)
			auth.POST("/totp/confirm", handler.ConfirmTOTP)
			auth.POST("/totp/disable", handler.DisableTOTP)
			auth.POST("/api-keys", handler.CreateAPIKey)
			auth.GET("/api-keys", handler.ListAPIKeys)
			auth.DELETE("/api-keys/:id", handler.DeleteAPIKey)
		}

		// Server management (admin only)
		server := protected.Group("/server")
		server.Use(middleware.RequireAdmin())
		{
			server.GET("", handler.GetServerConfig)
			server.PUT("", handler.UpdateServerConfig)
			server.GET("/status", handler.GetServerStatus)
			server.POST("/start", handler.ServerStart)
			server.POST("/stop", handler.ServerStop)
			server.POST("/restart", handler.ServerRestart)
		}

		// Clients
		clients := protected.Group("/clients")
		{
			clients.GET("", handler.ListClients)
			clients.GET("/:id", handler.GetClient)
			clients.POST("", middleware.RequireAdmin(), handler.CreateClient)
			clients.PUT("/:id", middleware.RequireAdmin(), handler.UpdateClient)
			clients.DELETE("/:id", middleware.RequireAdmin(), handler.DeleteClient)
			clients.GET("/:id/config", handler.GetClientConfig)
			clients.GET("/:id/qr", handler.GetClientQR)
		}

		// Live connections
		connections := protected.Group("/connections")
		{
			connections.GET("", handler.GetConnections)
			connections.DELETE("/:pubkey", middleware.RequireAdmin(), handler.DisconnectPeer)
		}

		// Audit logs
		protected.GET("/audit", middleware.RequireAdmin(), handler.GetAuditLogs)

		// Settings
		settings := protected.Group("/settings")
		settings.Use(middleware.RequireAdmin())
		{
			settings.GET("/endpoint", handler.GetPublicEndpoint)
			settings.PUT("/endpoint", handler.SetPublicEndpoint)
			settings.GET("/oidc", handler.GetOIDCConfig)
			settings.POST("/oidc", handler.UpsertOIDCConfig)
		}
	}

	// Serve frontend SPA from staticDir (if it exists)
	if staticDir != "" {
		if _, err := os.Stat(staticDir); err == nil {
			// Serve /assets/** (hashed JS/CSS bundles)
			router.Static("/assets", filepath.Join(staticDir, "assets"))

			// Serve root-level static files (favicon, icons, manifest, etc.)
			// Only serves if the file actually exists on disk; otherwise falls through to NoRoute.
			router.GET("/:file", func(c *gin.Context) {
				file := c.Param("file")
				fullPath := filepath.Join(staticDir, filepath.Base(file))
				if info, err := os.Stat(fullPath); err == nil && !info.IsDir() {
					c.File(fullPath)
					return
				}
				// Fall through to SPA index for client-side routes (e.g. /setup, /clients)
				indexPath := filepath.Join(staticDir, "index.html")
				if _, err := os.Stat(indexPath); err == nil {
					c.File(indexPath)
				} else {
					c.Status(http.StatusNotFound)
				}
			})

			// SPA fallback: multi-segment paths that don't match files → index.html
			router.NoRoute(func(c *gin.Context) {
				indexPath := filepath.Join(staticDir, "index.html")
				if _, err := os.Stat(indexPath); err == nil {
					c.File(indexPath)
				} else {
					c.Status(http.StatusNotFound)
				}
			})
		}
	}

	return router
}
