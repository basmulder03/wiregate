package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/basmulder03/wiregate/internal/update"
	"github.com/basmulder03/wiregate/internal/wireguard"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"gorm.io/gorm"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // CORS handled by gin middleware
	},
}

// Client represents a WebSocket client
type WSClient struct {
	conn *websocket.Conn
	send chan []byte
	hub  *Hub
}

// Hub manages all WebSocket connections
type Hub struct {
	clients    map[*WSClient]bool
	broadcast  chan []byte
	register   chan *WSClient
	unregister chan *WSClient
	mu         sync.RWMutex
}

// NewHub creates a new Hub
func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*WSClient]bool),
		broadcast:  make(chan []byte, 256),
		register:   make(chan *WSClient),
		unregister: make(chan *WSClient),
	}
}

// Run starts the Hub event loop
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()

		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()
		}
	}
}

// Broadcast sends a message to all connected WebSocket clients
func (h *Hub) Broadcast(data interface{}) {
	msg, err := json.Marshal(data)
	if err != nil {
		return
	}
	select {
	case h.broadcast <- msg:
	default:
	}
}

// BroadcastNotification sends a typed notification event to all WS clients.
// kind should be one of: "info", "success", "warning", "error".
func (h *Hub) BroadcastNotification(event, kind, title, message string) {
	h.Broadcast(gin.H{
		"type":      "notification",
		"event":     event,
		"kind":      kind,
		"title":     title,
		"message":   message,
		"timestamp": time.Now().Unix(),
	})
}

// StartConnectionPoller starts a goroutine that polls WireGuard connections
// and broadcasts real-time peer connect/disconnect notifications + connections updates.
func (h *Hub) StartConnectionPoller(db *gorm.DB, wgMgr *wireguard.Manager) {
	go func() {
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()

		// Track previously seen peer set to detect connect/disconnect events
		type peerKey = string
		prevPeers := map[peerKey]bool{}

		for range ticker.C {
			if len(h.clients) == 0 {
				continue
			}
			peers, err := wgMgr.GetConnectedPeers()
			if err != nil {
				continue
			}

			currentPeers := map[peerKey]bool{}
			for _, p := range peers {
				currentPeers[p.PublicKey] = true
			}

			// Detect newly connected peers
			for _, p := range peers {
				if !prevPeers[p.PublicKey] {
					clientName := p.PublicKey[:8] + "…"
					// Try to resolve the client name from DB
					type row struct{ Name string }
					var r row
					if db.Raw("SELECT name FROM clients WHERE public_key = ? LIMIT 1", p.PublicKey).Scan(&r).Error == nil && r.Name != "" {
						clientName = r.Name
					}
					h.BroadcastNotification("peer_connected", "info",
						"Peer connected", clientName+" connected to the VPN")
				}
			}

			// Detect disconnected peers
			for key := range prevPeers {
				if !currentPeers[key] {
					clientName := key[:8] + "…"
					var r struct{ Name string }
					if db.Raw("SELECT name FROM clients WHERE public_key = ? LIMIT 1", key).Scan(&r).Error == nil && r.Name != "" {
						clientName = r.Name
					}
					h.BroadcastNotification("peer_disconnected", "warning",
						"Peer disconnected", clientName+" disconnected from the VPN")
				}
			}

			prevPeers = currentPeers

			h.Broadcast(gin.H{
				"type":      "connections",
				"peers":     peers,
				"timestamp": time.Now().Unix(),
			})
		}
	}()
}

// StartUpdateChecker polls GitHub for new releases every 6 hours and
// broadcasts an "update_available" WS notification when a newer version is found.
// It also honours the auto-update window stored in SystemSettings.
func (h *Hub) StartUpdateChecker(db *gorm.DB, currentVersion string, method update.InstallMethod) {
	go func() {
		// Initial check after 30 s (give the server time to fully start)
		time.Sleep(30 * time.Second)
		h.checkAndMaybeUpdate(db, currentVersion, method)

		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			h.checkAndMaybeUpdate(db, currentVersion, method)
		}
	}()
}

func (h *Hub) checkAndMaybeUpdate(db *gorm.DB, currentVersion string, method update.InstallMethod) {
	release, err := update.FetchLatestRelease()
	if err != nil {
		log.Printf("update checker: %v", err)
		return
	}

	if !update.IsNewer(currentVersion, release.TagName) {
		return
	}

	log.Printf("update checker: new version available: %s (current: %s)", release.TagName, currentVersion)

	// Notify all WS clients
	h.Broadcast(gin.H{
		"type":           "notification",
		"event":          "update_available",
		"kind":           "info",
		"title":          "Update available",
		"message":        "WireGate " + release.TagName + " is available. You are running " + currentVersion + ".",
		"latest_tag":     release.TagName,
		"install_url":    release.HTMLURL,
		"install_method": string(method),
		"timestamp":      time.Now().Unix(),
	})

	// Auto-update if enabled and within the time window
	if shouldAutoUpdate(db) {
		log.Printf("update checker: auto-update triggered for %s", release.TagName)
		if err := update.PerformUpdate(release.TagName, method); err != nil {
			log.Printf("update checker: auto-update failed: %v", err)
			h.BroadcastNotification("update_failed", "error",
				"Auto-update failed", err.Error())
		}
	}
}

// shouldAutoUpdate returns true if auto-update is enabled and the current
// time falls within the configured maintenance window.
func shouldAutoUpdate(db *gorm.DB) bool {
	type setting struct{ Value string }
	var s setting

	// Check enabled flag
	if db.Raw("SELECT value FROM system_settings WHERE key = 'auto_update_enabled' LIMIT 1").Scan(&s).Error != nil {
		return false
	}
	if s.Value != "true" {
		return false
	}

	// Check time window: "HH:MM-HH:MM" stored in auto_update_window
	var ws setting
	if db.Raw("SELECT value FROM system_settings WHERE key = 'auto_update_window' LIMIT 1").Scan(&ws).Error != nil {
		return true // no window set → always allowed
	}
	return isWithinWindow(ws.Value)
}

// isWithinWindow parses "HH:MM-HH:MM" and returns true if now is inside the range.
func isWithinWindow(window string) bool {
	parts := splitN(window, "-", 2)
	if len(parts) != 2 {
		return true
	}
	now := time.Now()
	start, errS := parseHHMM(parts[0], now)
	end, errE := parseHHMM(parts[1], now)
	if errS != nil || errE != nil {
		return true
	}
	nowMins := now.Hour()*60 + now.Minute()
	startMins := start.Hour()*60 + start.Minute()
	endMins := end.Hour()*60 + end.Minute()

	if startMins <= endMins {
		return nowMins >= startMins && nowMins < endMins
	}
	// Wraps midnight
	return nowMins >= startMins || nowMins < endMins
}

func parseHHMM(s string, base time.Time) (time.Time, error) {
	var h, m int
	_, err := fmt.Sscanf(strings.TrimSpace(s), "%d:%d", &h, &m)
	if err != nil {
		return base, err
	}
	return time.Date(base.Year(), base.Month(), base.Day(), h, m, 0, 0, base.Location()), nil
}

func splitN(s, sep string, n int) []string {
	return strings.SplitN(s, sep, n)
}

func (c *WSClient) writePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *WSClient) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	c.conn.SetReadLimit(512)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("websocket error: %v", err)
			}
			break
		}
	}
}

// ServeWS handles WebSocket upgrade requests
// GET /api/ws
func (h *Handler) ServeWS(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("websocket upgrade error: %v", err)
		return
	}
	client := &WSClient{
		conn: conn,
		send: make(chan []byte, 256),
		hub:  h.hub,
	}
	h.hub.register <- client
	go client.writePump()
	go client.readPump()
}
