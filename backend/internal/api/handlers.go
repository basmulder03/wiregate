package api

import (
	"net/http"
	"time"

	"github.com/basmulder03/wiregate/internal/auth"
	"github.com/basmulder03/wiregate/internal/models"
	"github.com/basmulder03/wiregate/internal/wireguard"
	"github.com/gin-gonic/gin"
	qrcode "github.com/skip2/go-qrcode"
	"gorm.io/gorm"
)

// Handler holds all dependencies for API handlers
type Handler struct {
	db      *gorm.DB
	authSvc *auth.Service
	wgMgr   *wireguard.Manager
	hub     *Hub
}

// NewHandler creates a new API handler
func NewHandler(db *gorm.DB, authSvc *auth.Service, wgMgr *wireguard.Manager, hub *Hub) *Handler {
	return &Handler{
		db:      db,
		authSvc: authSvc,
		wgMgr:   wgMgr,
		hub:     hub,
	}
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
		// Create new server config
		if err := h.db.Create(&req).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, req)
		return
	}

	// Update existing
	h.db.Model(&server).Updates(&req)
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "WireGuard started"})
}

// ServerStop stops the WireGuard interface
// POST /api/server/stop
func (h *Handler) ServerStop(c *gin.Context) {
	if err := h.wgMgr.Stop(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "WireGuard stopped"})
}

// ServerRestart restarts the WireGuard interface
// POST /api/server/restart
func (h *Handler) ServerRestart(c *gin.Context) {
	if err := h.wgMgr.Restart(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
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
	c.JSON(http.StatusOK, gin.H{
		"setup_required": h.authSvc.IsSetupRequired(),
		"wg_installed":   wireguard.IsInstalled(),
		"wg_running":     h.wgMgr.IsRunning(),
	})
}

// --- Audit Log Handlers ---

// GetAuditLogs returns audit log entries
// GET /api/audit
func (h *Handler) GetAuditLogs(c *gin.Context) {
	var logs []models.AuditLog
	query := h.db.Order("created_at desc")

	if limit := c.Query("limit"); limit != "" {
		query = query.Limit(100)
	} else {
		query = query.Limit(100)
	}

	query.Find(&logs)
	c.JSON(http.StatusOK, logs)
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

// --- Helpers ---

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
	h.db.Where("server_id = ? AND enabled = ?", server.ID, true).Find(&clients)

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

func splitCIDR(cidr string) []string {
	// Returns [ip, prefix]
	parts := make([]string, 2)
	slash := -1
	for i, c := range cidr {
		if c == '/' {
			slash = i
			break
		}
	}
	if slash == -1 {
		parts[0] = cidr
		parts[1] = "24"
		return parts
	}
	parts[0] = cidr[:slash]
	parts[1] = cidr[slash+1:]
	return parts
}
