package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/spf13/viper"
)

// Config holds all application configuration
type Config struct {
	Server    ServerConfig    `mapstructure:"server"`
	Database  DatabaseConfig  `mapstructure:"database"`
	Auth      AuthConfig      `mapstructure:"auth"`
	WireGuard WireGuardConfig `mapstructure:"wireguard"`
}

type ServerConfig struct {
	Host           string   `mapstructure:"host"`
	Port           int      `mapstructure:"port"`
	JWTSecret      string   `mapstructure:"jwt_secret"`
	JWTExpiry      int      `mapstructure:"jwt_expiry_hours"`
	AllowedOrigins []string `mapstructure:"allowed_origins"`
	TLSEnabled     bool     `mapstructure:"tls_enabled"`
	TLSCertFile    string   `mapstructure:"tls_cert_file"`
	TLSKeyFile     string   `mapstructure:"tls_key_file"`
	StaticDir      string   `mapstructure:"static_dir"`
}

type DatabaseConfig struct {
	Driver string `mapstructure:"driver"` // sqlite, postgres (future)
	DSN    string `mapstructure:"dsn"`
	// Future: host, port, name, user, password for postgres
}

type AuthConfig struct {
	// OIDC is configured per-provider via DB, but can seed initial config via env
	OIDCEnabled bool `mapstructure:"oidc_enabled"`
}

type WireGuardConfig struct {
	ConfigDir string `mapstructure:"config_dir"`
	Interface string `mapstructure:"interface"`
	AutoApply bool   `mapstructure:"auto_apply"`
}

// Load reads configuration from file and environment variables
func Load() (*Config, error) {
	viper.SetConfigName("wiregate")
	viper.SetConfigType("yaml")
	viper.AddConfigPath("/etc/wiregate")
	viper.AddConfigPath("$HOME/.wiregate")
	viper.AddConfigPath(".")

	// Defaults
	viper.SetDefault("server.host", "0.0.0.0")
	viper.SetDefault("server.port", 8080)
	viper.SetDefault("server.jwt_expiry_hours", 24)
	viper.SetDefault("server.allowed_origins", []string{"*"})
	viper.SetDefault("database.driver", "sqlite")
	viper.SetDefault("database.dsn", "/var/lib/wiregate/wiregate.db")
	viper.SetDefault("wireguard.config_dir", "/etc/wireguard")
	viper.SetDefault("wireguard.interface", "wg0")
	viper.SetDefault("wireguard.auto_apply", true)
	viper.SetDefault("server.static_dir", "/var/lib/wiregate/www")

	// Environment variable support: WIREGATE_SERVER_PORT etc.
	viper.SetEnvPrefix("WIREGATE")
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	viper.AutomaticEnv()

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("error reading config file: %w", err)
		}
		// Config file not found is OK - use defaults + env vars
	}

	var cfg Config
	if err := viper.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("error unmarshaling config: %w", err)
	}

	// Generate JWT secret if not set
	if cfg.Server.JWTSecret == "" {
		cfg.Server.JWTSecret = generateRandomSecret(64)
	}

	return &cfg, nil
}

func generateRandomSecret(length int) string {
	// length is in bytes; the hex-encoded output will be length*2 chars
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		// rand.Read never fails on supported platforms, but handle it gracefully
		panic("wiregate: failed to generate JWT secret: " + err.Error())
	}
	return hex.EncodeToString(bytes)
}
