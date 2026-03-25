package models

import (
	"time"

	"gorm.io/gorm"
)

// Base replaces gorm.Model with explicit snake_case JSON tags so all
// embedded structs serialise consistently (id, created_at, updated_at).
type Base struct {
	ID        uint           `gorm:"primarykey"            json:"id"`
	CreatedAt time.Time      `                             json:"created_at"`
	UpdatedAt time.Time      `                             json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index"                 json:"-"`
}

// User represents an admin user of WireGate
type User struct {
	Base
	Username     string     `gorm:"uniqueIndex;not null" json:"username"`
	Email        string     `gorm:"uniqueIndex" json:"email"`
	PasswordHash string     `gorm:"not null" json:"-"`
	TOTPSecret   string     `json:"-"`
	TOTPEnabled  bool       `gorm:"default:false" json:"totp_enabled"`
	Role         string     `gorm:"default:'admin'" json:"role"`
	LastLogin    *time.Time `json:"last_login,omitempty"`
}

// APIKey represents an API key for programmatic access
type APIKey struct {
	Base
	Name      string     `gorm:"not null" json:"name"`
	KeyHash   string     `gorm:"uniqueIndex;not null" json:"-"`
	KeyPrefix string     `gorm:"not null" json:"key_prefix"`
	UserID    uint       `gorm:"not null" json:"user_id"`
	User      User       `json:"-"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	LastUsed  *time.Time `json:"last_used,omitempty"`
	Scopes    string     `gorm:"default:'read,write'" json:"scopes"`
}

// WireGuardServer represents the WireGuard server configuration
type WireGuardServer struct {
	Base
	Interface  string `gorm:"default:'wg0'" json:"interface"`
	PrivateKey string `gorm:"not null" json:"-"`
	PublicKey  string `gorm:"not null" json:"public_key"`
	ListenPort int    `gorm:"default:51820" json:"listen_port"`
	Address    string `gorm:"not null" json:"address"` // e.g. 10.0.0.1/24
	DNS        string `json:"dns"`
	PostUp     string `json:"post_up"`
	PostDown   string `json:"post_down"`
	MTU        int    `gorm:"default:1420" json:"mtu"`
	Enabled    bool   `gorm:"default:true" json:"enabled"`
}

// Client represents a WireGuard peer/client
type Client struct {
	Base
	Name         string     `gorm:"not null" json:"name"`
	Description  string     `json:"description"`
	PrivateKey   string     `gorm:"not null" json:"-"`
	PublicKey    string     `gorm:"uniqueIndex;not null" json:"public_key"`
	PresharedKey string     `json:"-"`
	AllowedIPs   string     `gorm:"not null" json:"allowed_ips"` // e.g. 10.0.0.2/32
	Endpoint     string     `json:"endpoint"`
	DNS          string     `json:"dns"`
	MTU          int        `gorm:"default:1420" json:"mtu"`
	Enabled      bool       `gorm:"default:true" json:"enabled"`
	ExpiresAt    *time.Time `json:"expires_at,omitempty"`
	ServerID     uint       `gorm:"not null" json:"server_id"`
}

// AuditLog stores audit trail entries
type AuditLog struct {
	Base
	UserID    *uint  `json:"user_id,omitempty"`
	Username  string `json:"username"`
	Action    string `gorm:"not null" json:"action"`
	Resource  string `json:"resource"`
	Details   string `json:"details"`
	IPAddress string `json:"ip_address"`
	Success   bool   `gorm:"default:true" json:"success"`
}

// OIDCConfig stores OIDC provider configuration
type OIDCConfig struct {
	Base
	ProviderName string `gorm:"not null" json:"provider_name"`
	IssuerURL    string `gorm:"not null" json:"issuer_url"`
	ClientID     string `gorm:"not null" json:"client_id"`
	ClientSecret string `gorm:"not null" json:"-"`
	RedirectURL  string `gorm:"not null" json:"redirect_url"`
	Scopes       string `gorm:"default:'openid,email,profile'" json:"scopes"`
	Enabled      bool   `gorm:"default:false" json:"enabled"`
}

// SystemSettings stores application-wide settings
type SystemSettings struct {
	Base
	Key   string `gorm:"uniqueIndex;not null" json:"key"`
	Value string `gorm:"not null" json:"value"`
}
