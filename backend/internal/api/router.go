package api

import (
	"io/fs"
	"net/http"
	"os"
	"path/filepath"

	"github.com/basmulder03/wiregate/internal/auth"
	"github.com/basmulder03/wiregate/internal/middleware"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

// SetupRouter creates and configures the Gin router.
// embeddedFS is an optional fs.FS containing the compiled frontend assets.
// When non-nil and staticDir is empty or missing on disk, the embedded FS is used.
func SetupRouter(handler *Handler, authSvc *auth.Service, allowedOrigins []string, staticDir string, embeddedFS fs.FS) *gin.Engine {
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
		// Version info (public so the UI can display it on login page too)
		public.GET("/version", handler.GetVersion)
	}

	// WebSocket (auth validated inside for ws compatibility)
	api.GET("/ws", middleware.AuthMiddleware(authSvc), handler.ServeWS)

	// Protected routes
	protected := api.Group("")
	protected.Use(middleware.AuthMiddleware(authSvc))
	{
		// Auth
		authGroup := protected.Group("/auth")
		{
			authGroup.GET("/me", handler.GetCurrentUser)
			authGroup.POST("/totp/setup", handler.SetupTOTP)
			authGroup.POST("/totp/confirm", handler.ConfirmTOTP)
			authGroup.POST("/totp/disable", handler.DisableTOTP)
			authGroup.POST("/api-keys", handler.CreateAPIKey)
			authGroup.GET("/api-keys", handler.ListAPIKeys)
			authGroup.DELETE("/api-keys/:id", handler.DeleteAPIKey)
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
			settings.GET("/updates", handler.GetUpdateSettings)
			settings.PUT("/updates", handler.SetUpdateSettings)
		}

		// System actions (admin only)
		system := protected.Group("/system")
		system.Use(middleware.RequireAdmin())
		{
			system.POST("/update", handler.TriggerUpdate)
		}
	}

	// --- Static / SPA serving ---
	// Priority: disk staticDir (dev / Docker) > embeddedFS (release binary)

	diskOK := staticDir != "" && func() bool {
		_, err := os.Stat(staticDir)
		return err == nil
	}()

	if diskOK {
		serveSPAFromDisk(router, staticDir)
	} else if embeddedFS != nil {
		serveSPAFromFS(router, embeddedFS)
	}

	return router
}

// serveSPAFromDisk mounts the SPA from a directory on disk.
func serveSPAFromDisk(router *gin.Engine, staticDir string) {
	router.Static("/assets", filepath.Join(staticDir, "assets"))

	router.GET("/:file", func(c *gin.Context) {
		file := c.Param("file")
		fullPath := filepath.Join(staticDir, filepath.Base(file))
		if info, err := os.Stat(fullPath); err == nil && !info.IsDir() {
			c.File(fullPath)
			return
		}
		indexPath := filepath.Join(staticDir, "index.html")
		if _, err := os.Stat(indexPath); err == nil {
			c.File(indexPath)
		} else {
			c.Status(http.StatusNotFound)
		}
	})

	router.NoRoute(func(c *gin.Context) {
		indexPath := filepath.Join(staticDir, "index.html")
		if _, err := os.Stat(indexPath); err == nil {
			c.File(indexPath)
		} else {
			c.Status(http.StatusNotFound)
		}
	})
}

// serveSPAFromFS mounts the SPA from an embedded fs.FS.
func serveSPAFromFS(router *gin.Engine, fsys fs.FS) {
	httpFS := http.FS(fsys)
	fileServer := http.FileServer(httpFS)

	// /assets/** served from the embedded FS
	router.GET("/assets/*filepath", func(c *gin.Context) {
		c.Request.URL.Path = "/assets" + c.Param("filepath")
		fileServer.ServeHTTP(c.Writer, c.Request)
	})

	// Root-level files (favicon, icons, manifest…)
	router.GET("/:file", func(c *gin.Context) {
		file := c.Param("file")
		if f, err := fsys.Open(file[1:]); err == nil {
			f.Close()
			c.Request.URL.Path = file
			fileServer.ServeHTTP(c.Writer, c.Request)
			return
		}
		// SPA fallback
		serveIndexFromFS(c, fsys)
	})

	router.NoRoute(func(c *gin.Context) {
		serveIndexFromFS(c, fsys)
	})
}

func serveIndexFromFS(c *gin.Context, fsys fs.FS) {
	data, err := fs.ReadFile(fsys, "index.html")
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", data)
}
