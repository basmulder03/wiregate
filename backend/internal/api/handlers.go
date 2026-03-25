package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/basmulder03/wiregate/internal/auth"
	"github.com/basmulder03/wiregate/internal/models"
	"github.com/basmulder03/wiregate/internal/update"
	"github.com/basmulder03/wiregate/internal/wireguard"
	gooidc "github.com/coreos/go-oidc/v3/oidc"
	"github.com/gin-gonic/gin"
	qrcode "github.com/skip2/go-qrcode"
	"golang.org/x/oauth2"
	"gorm.io/gorm"
)

// Handler holds all dependencies for API handlers
type Handler struct {
	db            *gorm.DB
	authSvc       *auth.Service
	wgMgr         *wireguard.Manager
	hub           *Hub
	version       string
	commit        string
	date          string
	installMethod update.InstallMethod
}

// NewHandler creates a new API handler
func NewHandler(db *gorm.DB, authSvc *auth.Service, wgMgr *wireguard.Manager, hub *Hub) *Handler {
	return &Handler{
		db:            db,
		authSvc:       authSvc,
		wgMgr:         wgMgr,
		hub:           hub,
		installMethod: update.DetectInstallMethod(),
	}
}

// SetVersionInfo stores the build-time version metadata in the handler.
func (h *Handler) SetVersionInfo(version, commit, date string) {
	h.version = version
	h.commit = commit
	h.date = date
}

// InstallMethod returns the detected installation method.
func (h *Handler) InstallMethod() update.InstallMethod {
	return h.installMethod
}

// --- Auth Handlers ---

// Login handles username/password authentication
// POST /api/auth/login
func (h *Handler) Login(c *gin.Context) {
	var req struct {
		Username string `json:"username" binding:"required"`
		Password string `json:"password" binding:"required"`
		TOTPCode string `json:"totp_code"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, totpRequired, err := h.authSvc.LoginWithPassword(req.Username, req.Password)
	if err != nil {
		h.writeAudit(c, nil, req.Username, "login", "auth", "invalid credentials", false)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	// If TOTP is enabled and no code provided, ask for it
	if totpRequired && req.TOTPCode == "" {
		c.JSON(http.StatusOK, gin.H{"totp_required": true})
		return
	}

	// Validate TOTP if required
	if totpRequired {
		if err := h.authSvc.ValidateTOTP(user.ID, req.TOTPCode); err != nil {
			h.writeAudit(c, &user.ID, user.Username, "login", "auth", "invalid TOTP code", false)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid TOTP code"})
			return
		}
	}

	token, err := h.authSvc.GenerateToken(user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	h.authSvc.UpdateLastLogin(user.ID)
	h.writeAudit(c, &user.ID, user.Username, "login", "auth", "login successful", true)

	c.JSON(http.StatusOK, gin.H{
		"token":   token,
		"user":    sanitizeUser(user),
		"expires": time.Now().Add(24 * time.Hour),
	})
}

// SetupAdmin creates the initial admin user (only if no users exist)
// POST /api/auth/setup
func (h *Handler) SetupAdmin(c *gin.Context) {
	if !h.authSvc.IsSetupRequired() {
		c.JSON(http.StatusForbidden, gin.H{"error": "setup already completed"})
		return
	}

	var req struct {
		Username string `json:"username" binding:"required,min=3"`
		Password string `json:"password" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := h.authSvc.CreateInitialAdmin(req.Username, req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	token, err := h.authSvc.GenerateToken(user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"token": token,
		"user":  sanitizeUser(user),
	})
}

// GetCurrentUser returns the currently authenticated user
// GET /api/auth/me
func (h *Handler) GetCurrentUser(c *gin.Context) {
	userID, _ := c.Get("user_id")
	var user models.User
	if err := h.db.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	c.JSON(http.StatusOK, sanitizeUser(&user))
}

// SetupTOTP initiates TOTP setup for the current user
// POST /api/auth/totp/setup
func (h *Handler) SetupTOTP(c *gin.Context) {
	userID, _ := c.Get("user_id")
	secret, qrURL, err := h.authSvc.SetupTOTP(userID.(uint))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"secret": secret,
		"qr_url": qrURL,
	})
}

// ConfirmTOTP confirms and enables TOTP for the current user
// POST /api/auth/totp/confirm
func (h *Handler) ConfirmTOTP(c *gin.Context) {
	userID, _ := c.Get("user_id")
	var req struct {
		Code string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.authSvc.ConfirmTOTP(userID.(uint), req.Code); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "TOTP enabled successfully"})
}

// DisableTOTP disables TOTP for the current user
// POST /api/auth/totp/disable
func (h *Handler) DisableTOTP(c *gin.Context) {
	userID, _ := c.Get("user_id")
	var req struct {
		Code string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.authSvc.DisableTOTP(userID.(uint), req.Code); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "TOTP disabled successfully"})
}

// --- API Key Handlers ---

// CreateAPIKey creates a new API key
// POST /api/auth/api-keys
func (h *Handler) CreateAPIKey(c *gin.Context) {
	userID, _ := c.Get("user_id")
	var req struct {
		Name      string     `json:"name" binding:"required"`
		Scopes    string     `json:"scopes"`
		ExpiresAt *time.Time `json:"expires_at"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Scopes == "" {
		req.Scopes = "read,write"
	}

	keyStr, apiKey, err := h.authSvc.CreateAPIKey(userID.(uint), req.Name, req.Scopes, req.ExpiresAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"key":     keyStr, // Only returned once!
		"api_key": apiKey,
	})
}

// ListAPIKeys lists all API keys for the current user
// GET /api/auth/api-keys
func (h *Handler) ListAPIKeys(c *gin.Context) {
	userID, _ := c.Get("user_id")
	var keys []models.APIKey
	h.db.Where("user_id = ?", userID).Find(&keys)
	c.JSON(http.StatusOK, keys)
}

// DeleteAPIKey deletes an API key
// DELETE /api/auth/api-keys/:id
func (h *Handler) DeleteAPIKey(c *gin.Context) {
	userID, _ := c.Get("user_id")
	id := c.Param("id")
	result := h.db.Where("id = ? AND user_id = ?", id, userID).Delete(&models.APIKey{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "API key not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "API key deleted"})
}

// --- Server Config Handlers ---

// GetServerConfig returns the current WireGuard server configuration
// GET /api/server
func (h *Handler) GetServerConfig(c *gin.Context) {
	var server models.WireGuardServer
	if err := h.db.First(&server).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not configured"})
		return
	}
	c.JSON(http.StatusOK, server)
}

// UpdateServerConfig updates the WireGuard server configuration
// PUT /api/server
func (h *Handler) UpdateServerConfig(c *gin.Context) {
	var req models.WireGuardServer
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var server models.WireGuardServer
	if err := h.db.First(&server).Error; err != nil {
		// First-time creation: auto-generate a keypair if none was provided.
		if req.PrivateKey == "" {
			priv, pub, kerr := wireguard.GenerateKeyPair()
			if kerr != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate WireGuard keys: " + kerr.Error()})
				return
			}
			req.PrivateKey = priv
			req.PublicKey = pub
		}
		if err := h.db.Create(&req).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// Write config file immediately so the interface can be started right away.
		h.applyServerConfig(&req)
		c.JSON(http.StatusCreated, req)
		return
	}

	// Update existing — regenerate keys only if the caller explicitly cleared them.
	if req.PrivateKey == "" && server.PrivateKey != "" {
		req.PrivateKey = server.PrivateKey
		req.PublicKey = server.PublicKey
	}
	h.db.Model(&server).Updates(&req)
	// Reload server after update so applyServerConfig uses fresh data.
	h.db.First(&server)
	h.applyServerConfig(&server)
	c.JSON(http.StatusOK, server)
}

// GetServerStatus returns WireGuard interface status
// GET /api/server/status
func (h *Handler) GetServerStatus(c *gin.Context) {
	running := h.wgMgr.IsRunning()
	status, _ := h.wgMgr.GetStatus()
	systemdStatus, _ := h.wgMgr.GetSystemdStatus()
	installed := wireguard.IsInstalled()

	c.JSON(http.StatusOK, gin.H{
		"installed":      installed,
		"running":        running,
		"status":         status,
		"systemd_status": systemdStatus,
	})
}

// ServerStart starts the WireGuard interface
// POST /api/server/start
func (h *Handler) ServerStart(c *gin.Context) {
	if err := h.wgMgr.Start(); err != nil {
		h.writeAudit(c, nil, ctxUsername(c), "server_start", "wireguard", err.Error(), false)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.writeAudit(c, ctxUserID(c), ctxUsername(c), "server_start", "wireguard", "WireGuard started", true)
	h.hub.BroadcastNotification("server_started", "success", "Server started", "WireGuard interface is now running")
	c.JSON(http.StatusOK, gin.H{"message": "WireGuard started"})
}

// ServerStop stops the WireGuard interface
// POST /api/server/stop
func (h *Handler) ServerStop(c *gin.Context) {
	if err := h.wgMgr.Stop(); err != nil {
		h.writeAudit(c, nil, ctxUsername(c), "server_stop", "wireguard", err.Error(), false)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.writeAudit(c, ctxUserID(c), ctxUsername(c), "server_stop", "wireguard", "WireGuard stopped", true)
	h.hub.BroadcastNotification("server_stopped", "warning", "Server stopped", "WireGuard interface has been stopped")
	c.JSON(http.StatusOK, gin.H{"message": "WireGuard stopped"})
}

// ServerRestart restarts the WireGuard interface
// POST /api/server/restart
func (h *Handler) ServerRestart(c *gin.Context) {
	if err := h.wgMgr.Restart(); err != nil {
		h.writeAudit(c, nil, ctxUsername(c), "server_restart", "wireguard", err.Error(), false)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.writeAudit(c, ctxUserID(c), ctxUsername(c), "server_restart", "wireguard", "WireGuard restarted", true)
	h.hub.BroadcastNotification("server_restarted", "info", "Server restarted", "WireGuard interface has been restarted")
	c.JSON(http.StatusOK, gin.H{"message": "WireGuard restarted"})
}

// --- Client Handlers ---

// ListClients returns all clients
// GET /api/clients
func (h *Handler) ListClients(c *gin.Context) {
	var clients []models.Client
	h.db.Find(&clients)
	c.JSON(http.StatusOK, clients)
}

// GetClient returns a specific client
// GET /api/clients/:id
func (h *Handler) GetClient(c *gin.Context) {
	id := c.Param("id")
	var client models.Client
	if err := h.db.First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "client not found"})
		return
	}
	c.JSON(http.StatusOK, client)
}

// CreateClient creates a new WireGuard client
// POST /api/clients
func (h *Handler) CreateClient(c *gin.Context) {
	var req struct {
		Name        string     `json:"name" binding:"required"`
		Description string     `json:"description"`
		DNS         string     `json:"dns"`
		MTU         int        `json:"mtu"`
		AllowedIPs  string     `json:"allowed_ips"` // if empty, auto-assign
		ExpiresAt   *time.Time `json:"expires_at"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get server config
	var server models.WireGuardServer
	if err := h.db.First(&server).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "server not configured yet"})
		return
	}

	// Auto-assign IP if not provided
	if req.AllowedIPs == "" {
		var usedIPs []string
		h.db.Model(&models.Client{}).Pluck("allowed_ips", &usedIPs)
		usedIPs = append(usedIPs, server.Address) // server IP is also taken

		// Get subnet from server address
		parts := splitCIDR(server.Address)
		ip, err := wireguard.GetNextAvailableIP(parts[0]+"/"+parts[1], usedIPs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "no available IPs: " + err.Error()})
			return
		}
		req.AllowedIPs = ip
	}

	// Generate key pair
	privKey, pubKey, err := wireguard.GenerateKeyPair()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate keys"})
		return
	}

	psk, err := wireguard.GeneratePresharedKey()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate preshared key"})
		return
	}

	client := models.Client{
		Name:         req.Name,
		Description:  req.Description,
		PrivateKey:   privKey,
		PublicKey:    pubKey,
		PresharedKey: psk,
		AllowedIPs:   req.AllowedIPs,
		DNS:          req.DNS,
		MTU:          req.MTU,
		Enabled:      true,
		ExpiresAt:    req.ExpiresAt,
		ServerID:     server.ID,
	}

	if client.MTU == 0 {
		client.MTU = 1420
	}
	if client.DNS == "" {
		client.DNS = server.DNS
	}

	if err := h.db.Create(&client).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.writeAudit(c, ctxUserID(c), ctxUsername(c), "create_client", "client:"+client.Name, "client created", true)

	h.hub.BroadcastNotification("client_created", "success",
		"Client created", "New client \""+client.Name+"\" was added by "+ctxUsername(c))

	h.applyServerConfig(&server)
	c.JSON(http.StatusCreated, client)
}

// UpdateClient updates a client
// PUT /api/clients/:id
func (h *Handler) UpdateClient(c *gin.Context) {
	id := c.Param("id")
	var client models.Client
	if err := h.db.First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "client not found"})
		return
	}

	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		DNS         string `json:"dns"`
		Enabled     *bool  `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Name != "" {
		client.Name = req.Name
	}
	if req.Description != "" {
		client.Description = req.Description
	}
	if req.DNS != "" {
		client.DNS = req.DNS
	}
	if req.Enabled != nil {
		client.Enabled = *req.Enabled
	}

	h.db.Save(&client)

	var server models.WireGuardServer
	if h.db.First(&server).Error == nil {
		h.applyServerConfig(&server)
	}

	c.JSON(http.StatusOK, client)
}

// DeleteClient deletes a client
// DELETE /api/clients/:id
func (h *Handler) DeleteClient(c *gin.Context) {
	id := c.Param("id")
	var client models.Client
	if err := h.db.First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "client not found"})
		return
	}
	h.db.Delete(&client)

	// Remove from live interface if running
	if h.wgMgr.IsRunning() {
		h.wgMgr.DisconnectPeer(client.PublicKey)
	}

	h.writeAudit(c, ctxUserID(c), ctxUsername(c), "delete_client", "client:"+client.Name, "client deleted", true)

	h.hub.BroadcastNotification("client_deleted", "warning",
		"Client deleted", "Client \""+client.Name+"\" was removed by "+ctxUsername(c))

	var server models.WireGuardServer
	if h.db.First(&server).Error == nil {
		h.applyServerConfig(&server)
	}

	c.JSON(http.StatusOK, gin.H{"message": "client deleted"})
}

// GetClientConfig returns the client's WireGuard config file content
// GET /api/clients/:id/config
func (h *Handler) GetClientConfig(c *gin.Context) {
	id := c.Param("id")
	var client models.Client
	if err := h.db.First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "client not found"})
		return
	}

	var server models.WireGuardServer
	if err := h.db.First(&server).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "server not configured"})
		return
	}

	// Determine server public endpoint
	serverEndpoint := client.Endpoint
	if serverEndpoint == "" {
		// Try to get from settings
		var setting models.SystemSettings
		if h.db.Where("key = ?", "server_public_endpoint").First(&setting).Error == nil {
			serverEndpoint = setting.Value
		}
	}

	conf := &wireguard.ClientConf{
		PrivateKey:      client.PrivateKey,
		Address:         client.AllowedIPs,
		DNS:             client.DNS,
		MTU:             client.MTU,
		ServerPublicKey: server.PublicKey,
		PresharedKey:    client.PresharedKey,
		AllowedIPs:      "0.0.0.0/0, ::/0",
		Endpoint:        serverEndpoint,
	}

	configStr, err := wireguard.GenerateClientConfig(conf)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"config":   configStr,
		"filename": client.Name + ".conf",
	})
}

// GetClientQR returns a QR code PNG for the client's WireGuard config
// GET /api/clients/:id/qr
func (h *Handler) GetClientQR(c *gin.Context) {
	id := c.Param("id")
	var client models.Client
	if err := h.db.First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "client not found"})
		return
	}

	var server models.WireGuardServer
	if err := h.db.First(&server).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "server not configured"})
		return
	}

	serverEndpoint := client.Endpoint
	if serverEndpoint == "" {
		var setting models.SystemSettings
		if h.db.Where("key = ?", "server_public_endpoint").First(&setting).Error == nil {
			serverEndpoint = setting.Value
		}
	}

	conf := &wireguard.ClientConf{
		PrivateKey:      client.PrivateKey,
		Address:         client.AllowedIPs,
		DNS:             client.DNS,
		MTU:             client.MTU,
		ServerPublicKey: server.PublicKey,
		PresharedKey:    client.PresharedKey,
		AllowedIPs:      "0.0.0.0/0, ::/0",
		Endpoint:        serverEndpoint,
	}

	configStr, err := wireguard.GenerateClientConfig(conf)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	png, err := qrcode.Encode(configStr, qrcode.Medium, 256)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate QR code"})
		return
	}

	c.Data(http.StatusOK, "image/png", png)
}

// --- Connection Handlers ---

// GetConnections returns currently active connections
// GET /api/connections
func (h *Handler) GetConnections(c *gin.Context) {
	peers, err := h.wgMgr.GetConnectedPeers()
	if err != nil {
		c.JSON(http.StatusOK, []interface{}{}) // Return empty if WG not running
		return
	}

	// Enrich with client names
	type EnrichedPeer struct {
		wireguard.ConnectedPeer
		ClientName string `json:"client_name"`
		ClientID   uint   `json:"client_id"`
	}

	var enriched []EnrichedPeer
	for _, peer := range peers {
		ep := EnrichedPeer{ConnectedPeer: peer}
		var client models.Client
		if h.db.Where("public_key = ?", peer.PublicKey).First(&client).Error == nil {
			ep.ClientName = client.Name
			ep.ClientID = client.ID
		}
		enriched = append(enriched, ep)
	}

	c.JSON(http.StatusOK, enriched)
}

// DisconnectPeer disconnects a specific peer by public key
// DELETE /api/connections/:pubkey
func (h *Handler) DisconnectPeer(c *gin.Context) {
	pubKey := c.Param("pubkey")
	if err := h.wgMgr.DisconnectPeer(pubKey); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "peer disconnected"})
}

// --- Setup Handler ---

// GetSetupStatus returns whether initial setup is required
// GET /api/setup/status
func (h *Handler) GetSetupStatus(c *gin.Context) {
	adminConfigured := !h.authSvc.IsSetupRequired()
	serverConfigured := h.isServerConfigured()
	setupRequired := !(adminConfigured && serverConfigured)

	c.JSON(http.StatusOK, gin.H{
		"setup_required":    setupRequired,
		"admin_configured":  adminConfigured,
		"server_configured": serverConfigured,
		"wg_installed":      wireguard.IsInstalled(),
		"wg_running":        h.wgMgr.IsRunning(),
	})
}

// --- Audit Log Handlers ---

// GetAuditLogs returns audit log entries
// GET /api/audit
func (h *Handler) GetAuditLogs(c *gin.Context) {
	var logs []models.AuditLog
	query := h.db.Model(&models.AuditLog{})

	page := 1
	if pStr := c.Query("page"); pStr != "" {
		if parsed, err := strconv.Atoi(pStr); err == nil && parsed > 0 {
			page = parsed
		}
	}

	pageSize := 100
	if psStr := c.Query("page_size"); psStr != "" {
		if parsed, err := strconv.Atoi(psStr); err == nil && parsed > 0 {
			pageSize = parsed
		}
	} else if lStr := c.Query("limit"); lStr != "" {
		if parsed, err := strconv.Atoi(lStr); err == nil && parsed > 0 {
			pageSize = parsed
		}
	}
	if pageSize > 500 {
		pageSize = 500
	}

	rawQuery := strings.TrimSpace(c.Query("query"))
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		like := "%" + q + "%"
		query = query.Where(
			"username LIKE ? OR action LIKE ? OR resource LIKE ? OR details LIKE ? OR ip_address LIKE ?",
			like, like, like, like, like,
		)
	}

	if action := strings.TrimSpace(c.Query("action")); action != "" {
		query = query.Where("action LIKE ?", "%"+action+"%")
	}

	if username := strings.TrimSpace(c.Query("username")); username != "" {
		query = query.Where("username LIKE ?", "%"+username+"%")
	}

	if resource := strings.TrimSpace(c.Query("resource")); resource != "" {
		query = query.Where("resource LIKE ?", "%"+resource+"%")
	}

	if ipAddress := strings.TrimSpace(c.Query("ip")); ipAddress != "" {
		query = query.Where("ip_address LIKE ?", "%"+ipAddress+"%")
	}

	if status := strings.TrimSpace(c.Query("status")); status != "" {
		switch status {
		case "success":
			query = query.Where("success = ?", true)
		case "failed":
			query = query.Where("success = ?", false)
		}
	}

	sortField := c.DefaultQuery("sort", "created_at")
	allowedSorts := map[string]string{
		"created_at": "created_at",
		"username":   "username",
		"action":     "action",
		"resource":   "resource",
		"ip_address": "ip_address",
		"success":    "success",
	}
	column, ok := allowedSorts[sortField]
	if !ok {
		column = "created_at"
		sortField = "created_at"
	}

	sortOrder := strings.ToLower(c.DefaultQuery("order", "desc"))
	if sortOrder != "asc" {
		sortOrder = "desc"
	}

	if rawQuery != "" {
		expr, err := parseAuditExpr(rawQuery)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid audit query: " + err.Error()})
			return
		}

		var allLogs []models.AuditLog
		query.Order("created_at desc").Find(&allLogs)
		filtered := filterAuditLogs(allLogs, expr)
		successTotal := 0
		for _, log := range filtered {
			if log.Success {
				successTotal++
			}
		}
		failedTotal := len(filtered) - successTotal

		sortAuditLogs(filtered, sortField, sortOrder)
		total := len(filtered)
		start := (page - 1) * pageSize
		if start > total {
			start = total
		}
		end := start + pageSize
		if end > total {
			end = total
		}
		logs = filtered[start:end]

		c.JSON(http.StatusOK, gin.H{
			"items":         logs,
			"total":         total,
			"page":          page,
			"page_size":     pageSize,
			"sort":          sortField,
			"order":         sortOrder,
			"success_total": successTotal,
			"failed_total":  failedTotal,
		})
		return
	}

	countQuery := query.Session(&gorm.Session{})
	successQuery := query.Session(&gorm.Session{})

	var total int64
	countQuery.Count(&total)

	var successTotal int64
	successQuery.Where("success = ?", true).Count(&successTotal)
	failedTotal := total - successTotal

	query = query.Order(column + " " + sortOrder).Offset((page - 1) * pageSize).Limit(pageSize)
	query.Find(&logs)

	c.JSON(http.StatusOK, gin.H{
		"items":         logs,
		"total":         total,
		"page":          page,
		"page_size":     pageSize,
		"sort":          sortField,
		"order":         sortOrder,
		"success_total": successTotal,
		"failed_total":  failedTotal,
	})
}

// --- System Settings Handlers ---

// GetPublicEndpoint returns the server's public endpoint setting
// GET /api/settings/endpoint
func (h *Handler) GetPublicEndpoint(c *gin.Context) {
	var setting models.SystemSettings
	if err := h.db.Where("key = ?", "server_public_endpoint").First(&setting).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"endpoint": ""})
		return
	}
	c.JSON(http.StatusOK, gin.H{"endpoint": setting.Value})
}

// SetPublicEndpoint saves the server's public endpoint setting
// PUT /api/settings/endpoint
func (h *Handler) SetPublicEndpoint(c *gin.Context) {
	var req struct {
		Endpoint string `json:"endpoint"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var setting models.SystemSettings
	if err := h.db.Where("key = ?", "server_public_endpoint").First(&setting).Error; err != nil {
		setting = models.SystemSettings{Key: "server_public_endpoint", Value: req.Endpoint}
		h.db.Create(&setting)
	} else {
		h.db.Model(&setting).Update("value", req.Endpoint)
	}
	c.JSON(http.StatusOK, gin.H{"endpoint": req.Endpoint})
}

// --- OIDC Login Flow ---

// ListOIDCProviders returns enabled OIDC providers (public, used by login page)
// GET /api/auth/oidc/providers
func (h *Handler) ListOIDCProviders(c *gin.Context) {
	var configs []models.OIDCConfig
	h.db.Where("enabled = ?", true).Find(&configs)

	type providerInfo struct {
		ID           uint   `json:"id"`
		ProviderName string `json:"provider_name"`
	}
	var out []providerInfo
	for _, cfg := range configs {
		out = append(out, providerInfo{ID: cfg.ID, ProviderName: cfg.ProviderName})
	}
	if out == nil {
		out = []providerInfo{}
	}
	c.JSON(http.StatusOK, out)
}

// OIDCLoginURL redirects the browser to the provider's authorization endpoint
// GET /api/auth/oidc/:provider/login
func (h *Handler) OIDCLoginURL(c *gin.Context) {
	providerName := c.Param("provider")
	cfg, err := h.findOIDCConfig(providerName)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "OIDC provider not found or disabled"})
		return
	}

	oauth2Cfg, err := h.buildOAuth2Config(c.Request.Context(), cfg)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to initialise OIDC provider: " + err.Error()})
		return
	}

	// Generate and persist a random state token (30-min TTL via key name)
	stateBytes := make([]byte, 16)
	rand.Read(stateBytes) //nolint:errcheck
	state := hex.EncodeToString(stateBytes)
	stateKey := "oidc_state_" + state
	h.db.Save(&models.SystemSettings{Key: stateKey, Value: cfg.ProviderName})

	url := oauth2Cfg.AuthCodeURL(state, oauth2.AccessTypeOnline)
	c.Redirect(http.StatusFound, url)
}

// OIDCCallback handles the provider redirect back to WireGate
// GET /api/auth/oidc/:provider/callback
func (h *Handler) OIDCCallback(c *gin.Context) {
	providerName := c.Param("provider")
	cfg, err := h.findOIDCConfig(providerName)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "OIDC provider not found or disabled"})
		return
	}

	// Validate state
	state := c.Query("state")
	stateKey := "oidc_state_" + state
	var stateSetting models.SystemSettings
	if h.db.Where("key = ?", stateKey).First(&stateSetting).Error != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid or expired state"})
		return
	}
	h.db.Where("key = ?", stateKey).Delete(&models.SystemSettings{})

	// Exchange code for tokens
	oauth2Cfg, err := h.buildOAuth2Config(c.Request.Context(), cfg)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "OIDC init failed: " + err.Error()})
		return
	}

	code := c.Query("code")
	token, err := oauth2Cfg.Exchange(c.Request.Context(), code)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "code exchange failed: " + err.Error()})
		return
	}

	// Verify ID token
	provider, err := gooidc.NewProvider(c.Request.Context(), cfg.IssuerURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "OIDC provider init failed"})
		return
	}
	verifier := provider.Verifier(&gooidc.Config{ClientID: cfg.ClientID})
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no id_token in response"})
		return
	}
	idToken, err := verifier.Verify(c.Request.Context(), rawIDToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "id_token verification failed"})
		return
	}

	var claims struct {
		Email   string `json:"email"`
		Name    string `json:"name"`
		Subject string `json:"sub"`
	}
	if err := idToken.Claims(&claims); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse claims"})
		return
	}

	// Find or create user
	username := claims.Email
	if username == "" {
		username = claims.Subject
	}
	var user models.User
	if h.db.Where("username = ?", username).First(&user).Error != nil {
		// Create new user from OIDC identity
		user = models.User{
			Username: username,
			Email:    claims.Email,
			Role:     "admin",
			// No PasswordHash — OIDC-only account
		}
		if err := h.db.Create(&user).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create user"})
			return
		}
	}

	jwt, err := h.authSvc.GenerateToken(&user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	h.authSvc.UpdateLastLogin(user.ID)
	h.writeAudit(c, &user.ID, user.Username, "login", "auth", "OIDC login via "+cfg.ProviderName, true)

	// Redirect to frontend with token in query string; frontend picks it up and stores it
	c.Redirect(http.StatusFound, "/?token="+jwt)
}

// findOIDCConfig looks up an enabled OIDCConfig by provider name or numeric ID string.
func (h *Handler) findOIDCConfig(nameOrID string) (*models.OIDCConfig, error) {
	var cfg models.OIDCConfig
	query := h.db.Where("enabled = ?", true)
	// try numeric ID first
	if id, err := strconv.Atoi(nameOrID); err == nil {
		query = query.Where("id = ?", id)
	} else {
		query = query.Where("provider_name = ?", nameOrID)
	}
	if err := query.First(&cfg).Error; err != nil {
		return nil, err
	}
	return &cfg, nil
}

// buildOAuth2Config constructs an oauth2.Config from an OIDCConfig row.
func (h *Handler) buildOAuth2Config(ctx context.Context, cfg *models.OIDCConfig) (*oauth2.Config, error) {
	provider, err := gooidc.NewProvider(ctx, cfg.IssuerURL)
	if err != nil {
		return nil, err
	}
	scopes := strings.Split(cfg.Scopes, ",")
	for i := range scopes {
		scopes[i] = strings.TrimSpace(scopes[i])
	}
	return &oauth2.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecret,
		RedirectURL:  cfg.RedirectURL,
		Endpoint:     provider.Endpoint(),
		Scopes:       scopes,
	}, nil
}

// --- OIDC Config ---

// GetOIDCConfig returns OIDC configuration
// GET /api/settings/oidc
func (h *Handler) GetOIDCConfig(c *gin.Context) {
	var configs []models.OIDCConfig
	h.db.Find(&configs)
	c.JSON(http.StatusOK, configs)
}

// UpsertOIDCConfig creates or updates an OIDC provider config
// POST /api/settings/oidc
func (h *Handler) UpsertOIDCConfig(c *gin.Context) {
	var req models.OIDCConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.db.Save(&req).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, req)
}

// DeleteOIDCConfig deletes an OIDC provider config by ID
// DELETE /api/settings/oidc/:id
func (h *Handler) DeleteOIDCConfig(c *gin.Context) {
	id := c.Param("id")
	result := h.db.Delete(&models.OIDCConfig{}, id)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "OIDC config not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "OIDC provider deleted"})
}

// --- User Management ---

// ListUsers returns all users (admin only)
// GET /api/users
func (h *Handler) ListUsers(c *gin.Context) {
	var users []models.User
	h.db.Find(&users)
	out := make([]gin.H, 0, len(users))
	for i := range users {
		out = append(out, sanitizeUser(&users[i]))
	}
	c.JSON(http.StatusOK, out)
}

// GetUser returns a single user by ID (admin only)
// GET /api/users/:id
func (h *Handler) GetUser(c *gin.Context) {
	id := c.Param("id")
	var user models.User
	if err := h.db.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	c.JSON(http.StatusOK, sanitizeUser(&user))
}

// CreateUser creates a new user (admin only)
// POST /api/users
func (h *Handler) CreateUser(c *gin.Context) {
	var req struct {
		Username string `json:"username" binding:"required,min=3"`
		Password string `json:"password" binding:"required,min=8"`
		Email    string `json:"email"`
		Role     string `json:"role"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Role == "" {
		req.Role = "user"
	}
	if req.Role != "admin" && req.Role != "user" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "role must be 'admin' or 'user'"})
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}

	user := models.User{
		Username:     req.Username,
		Email:        req.Email,
		PasswordHash: hash,
		Role:         req.Role,
	}
	if err := h.db.Create(&user).Error; err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "username already exists"})
		return
	}

	h.writeAudit(c, ctxUserID(c), ctxUsername(c), "create_user", "user:"+user.Username, "user created", true)
	c.JSON(http.StatusCreated, sanitizeUser(&user))
}

// UpdateUser updates a user's details (admin only, or self for non-sensitive fields)
// PUT /api/users/:id
func (h *Handler) UpdateUser(c *gin.Context) {
	id := c.Param("id")
	var user models.User
	if err := h.db.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	var req struct {
		Email    string `json:"email"`
		Role     string `json:"role"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]interface{}{}
	if req.Email != "" {
		updates["email"] = req.Email
	}
	if req.Role != "" {
		if req.Role != "admin" && req.Role != "user" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "role must be 'admin' or 'user'"})
			return
		}
		updates["role"] = req.Role
	}
	if req.Password != "" {
		if len(req.Password) < 8 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "password must be at least 8 characters"})
			return
		}
		hash, err := auth.HashPassword(req.Password)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
			return
		}
		updates["password_hash"] = hash
	}

	if len(updates) > 0 {
		h.db.Model(&user).Updates(updates)
		h.db.First(&user, id) // reload
	}

	h.writeAudit(c, ctxUserID(c), ctxUsername(c), "update_user", "user:"+user.Username, "user updated", true)
	c.JSON(http.StatusOK, sanitizeUser(&user))
}

// DeleteUser deletes a user (admin only; cannot delete yourself)
// DELETE /api/users/:id
func (h *Handler) DeleteUser(c *gin.Context) {
	id := c.Param("id")

	// Prevent self-deletion
	selfID, _ := c.Get("user_id")
	if fmt.Sprintf("%v", selfID) == id {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot delete your own account"})
		return
	}

	var user models.User
	if err := h.db.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	h.db.Delete(&user)
	h.writeAudit(c, ctxUserID(c), ctxUsername(c), "delete_user", "user:"+user.Username, "user deleted", true)
	c.JSON(http.StatusOK, gin.H{"message": "user deleted"})
}

// --- Helpers ---

// ctxUserID extracts the user ID from the gin context (set by AuthMiddleware).
func ctxUserID(c *gin.Context) *uint {
	v, _ := c.Get("user_id")
	id, ok := v.(uint)
	if !ok {
		return nil
	}
	return &id
}

// ctxUsername extracts the username from the gin context (set by AuthMiddleware).
func ctxUsername(c *gin.Context) string {
	v, _ := c.Get("username")
	s, _ := v.(string)
	return s
}

// writeAudit persists a single audit log entry (fire-and-forget; errors are silently swallowed).
func (h *Handler) writeAudit(c *gin.Context, userID *uint, username, action, resource, details string, success bool) {
	entry := models.AuditLog{
		UserID:    userID,
		Username:  username,
		Action:    action,
		Resource:  resource,
		Details:   details,
		IPAddress: c.ClientIP(),
		Success:   success,
	}
	h.db.Create(&entry)
}

func sanitizeUser(u *models.User) gin.H {
	return gin.H{
		"id":           u.ID,
		"username":     u.Username,
		"email":        u.Email,
		"role":         u.Role,
		"totp_enabled": u.TOTPEnabled,
		"last_login":   u.LastLogin,
		"created_at":   u.CreatedAt,
	}
}

// applyServerConfig writes the WireGuard config and reloads if running
func (h *Handler) applyServerConfig(server *models.WireGuardServer) {
	var clients []models.Client
	now := time.Now()
	h.db.Where("server_id = ? AND enabled = ? AND (expires_at IS NULL OR expires_at > ?)", server.ID, true, now).Find(&clients)

	var peers []wireguard.PeerConf
	for _, c := range clients {
		peers = append(peers, wireguard.PeerConf{
			PublicKey:    c.PublicKey,
			PresharedKey: c.PresharedKey,
			AllowedIPs:   c.AllowedIPs,
		})
	}

	conf := &wireguard.ServerConf{
		PrivateKey: server.PrivateKey,
		Address:    server.Address,
		ListenPort: server.ListenPort,
		DNS:        server.DNS,
		MTU:        server.MTU,
		PostUp:     server.PostUp,
		PostDown:   server.PostDown,
		Peers:      peers,
	}

	h.wgMgr.WriteConfig(conf)

	if h.wgMgr.IsRunning() {
		h.wgMgr.Reload(conf)
	}
}

// StartExpiryEnforcer launches a background goroutine that ticks every minute,
// finds clients whose expires_at has passed and are still enabled, disconnects
// them from WireGuard, and regenerates the server config.
func (h *Handler) StartExpiryEnforcer() {
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			h.enforceExpiry()
		}
	}()
}

func (h *Handler) enforceExpiry() {
	var server models.WireGuardServer
	if err := h.db.Limit(1).Find(&server).Error; err != nil {
		return // db error
	}
	if server.ID == 0 {
		return // no server configured yet
	}

	var expired []models.Client
	now := time.Now()
	h.db.Where(
		"server_id = ? AND enabled = ? AND expires_at IS NOT NULL AND expires_at <= ?",
		server.ID, true, now,
	).Find(&expired)

	if len(expired) == 0 {
		return
	}

	for _, client := range expired {
		if err := h.wgMgr.DisconnectPeer(client.PublicKey); err != nil {
			log.Printf("expiry enforcer: failed to disconnect peer %s: %v", client.PublicKey, err)
		}
		// Mark disabled so we don't keep trying
		h.db.Model(&client).Update("enabled", false)
		log.Printf("expiry enforcer: disabled expired client %q (id=%d)", client.Name, client.ID)
		h.hub.BroadcastNotification("client_expired", "warning",
			"Client expired", "Client \""+client.Name+"\" has been disabled due to expiry")
	}

	h.applyServerConfig(&server)
}

// --- Version & Update Handlers ---

// GetVersion returns the running version, build info, install method, and latest release info.
// GET /api/version
func (h *Handler) GetVersion(c *gin.Context) {
	info := gin.H{
		"version":        h.version,
		"commit":         h.commit,
		"date":           h.date,
		"install_method": string(h.installMethod),
	}

	// Check for latest release (non-blocking with short timeout)
	release, err := update.FetchLatestRelease()
	if err == nil {
		info["latest_tag"] = release.TagName
		info["latest_url"] = release.HTMLURL
		info["update_available"] = update.IsNewer(h.version, release.TagName)
	} else if !errors.Is(err, update.ErrNoPublishedRelease) {
		log.Printf("version check: %v", err)
	}

	c.JSON(http.StatusOK, info)
}

// GetUpdateSettings returns the auto-update configuration.
// GET /api/settings/updates
func (h *Handler) GetUpdateSettings(c *gin.Context) {
	enabled := h.getSetting("auto_update_enabled", "false")
	window := h.getSetting("auto_update_window", "02:00-04:00")
	c.JSON(http.StatusOK, gin.H{
		"auto_update_enabled": enabled == "true",
		"auto_update_window":  window,
	})
}

// SetUpdateSettings saves the auto-update configuration.
// PUT /api/settings/updates
func (h *Handler) SetUpdateSettings(c *gin.Context) {
	var req struct {
		AutoUpdateEnabled bool   `json:"auto_update_enabled"`
		AutoUpdateWindow  string `json:"auto_update_window"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	enabledStr := "false"
	if req.AutoUpdateEnabled {
		enabledStr = "true"
	}
	h.setSetting("auto_update_enabled", enabledStr)

	window := req.AutoUpdateWindow
	if window == "" {
		window = "02:00-04:00"
	}
	h.setSetting("auto_update_window", window)

	c.JSON(http.StatusOK, gin.H{
		"auto_update_enabled": req.AutoUpdateEnabled,
		"auto_update_window":  window,
	})
}

// TriggerUpdate downloads and installs the latest release, then restarts.
// POST /api/system/update
func (h *Handler) TriggerUpdate(c *gin.Context) {
	release, err := update.FetchLatestRelease()
	if err != nil {
		if errors.Is(err, update.ErrNoPublishedRelease) {
			c.JSON(http.StatusOK, gin.H{"message": "no published release available yet"})
			return
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "could not fetch release info: " + err.Error()})
		return
	}
	if !update.IsNewer(h.version, release.TagName) {
		c.JSON(http.StatusOK, gin.H{"message": "already up to date", "version": h.version})
		return
	}

	// Return 200 immediately; the actual replacement happens async
	c.JSON(http.StatusOK, gin.H{
		"message":        "update initiated; server will restart shortly",
		"target":         release.TagName,
		"install_method": string(h.installMethod),
	})

	go func() {
		if err := update.PerformUpdate(release.TagName, h.installMethod); err != nil {
			log.Printf("manual update failed: %v", err)
			h.hub.BroadcastNotification("update_failed", "error",
				"Update failed", err.Error())
		}
	}()
}

// --- Update Settings helpers ---

func (h *Handler) getSetting(key, defaultVal string) string {
	var s models.SystemSettings
	if h.db.Where("key = ?", key).First(&s).Error != nil {
		return defaultVal
	}
	return s.Value
}

func (h *Handler) setSetting(key, value string) {
	var s models.SystemSettings
	if h.db.Where("key = ?", key).First(&s).Error != nil {
		h.db.Create(&models.SystemSettings{Key: key, Value: value})
	} else {
		h.db.Model(&s).Update("value", value)
	}
}

func splitCIDR(cidr string) []string {
	// Returns [ip, prefix]. Uses the stdlib to be correct with edge cases.
	parts := strings.SplitN(cidr, "/", 2)
	if len(parts) == 2 {
		return parts
	}
	return []string{cidr, "24"}
}
