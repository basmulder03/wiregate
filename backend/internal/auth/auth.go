package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/basmulder03/wiregate/internal/models"
	"github.com/golang-jwt/jwt/v5"
	"github.com/pquerna/otp/totp"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// Service handles all authentication operations
type Service struct {
	db        *gorm.DB
	jwtSecret string
	jwtExpiry time.Duration
}

// Claims is the JWT claims structure
type Claims struct {
	UserID   uint   `json:"uid"`
	Username string `json:"sub"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

// NewService creates a new auth service
func NewService(db *gorm.DB, jwtSecret string, jwtExpiryHours int) *Service {
	return &Service{
		db:        db,
		jwtSecret: jwtSecret,
		jwtExpiry: time.Duration(jwtExpiryHours) * time.Hour,
	}
}

// --- Password Auth ---

// HashPassword hashes a password with bcrypt
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// CheckPassword verifies a password against a hash
func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// LoginWithPassword authenticates a user with username/password
// Returns the user if auth succeeds, and whether TOTP is required
func (s *Service) LoginWithPassword(username, password string) (*models.User, bool, error) {
	var user models.User
	result := s.db.Where("username = ?", username).First(&user)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, false, fmt.Errorf("invalid credentials")
		}
		return nil, false, result.Error
	}

	if !CheckPassword(user.PasswordHash, password) {
		return nil, false, fmt.Errorf("invalid credentials")
	}

	return &user, user.TOTPEnabled, nil
}

// --- TOTP ---

// SetupTOTP generates a new TOTP secret and QR code URL for a user
func (s *Service) SetupTOTP(userID uint) (secret, qrURL string, err error) {
	var user models.User
	if err = s.db.First(&user, userID).Error; err != nil {
		return
	}

	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "WireGate",
		AccountName: user.Username,
	})
	if err != nil {
		return
	}

	secret = key.Secret()
	qrURL = key.URL()

	// Store secret (not yet enabled - user must confirm a valid code first)
	s.db.Model(&user).Update("totp_secret", secret)
	return
}

// ConfirmTOTP verifies a TOTP code and enables TOTP for the user
func (s *Service) ConfirmTOTP(userID uint, code string) error {
	var user models.User
	if err := s.db.First(&user, userID).Error; err != nil {
		return err
	}
	if !totp.Validate(code, user.TOTPSecret) {
		return fmt.Errorf("invalid TOTP code")
	}
	return s.db.Model(&user).Update("totp_enabled", true).Error
}

// ValidateTOTP validates a TOTP code for a user
func (s *Service) ValidateTOTP(userID uint, code string) error {
	var user models.User
	if err := s.db.First(&user, userID).Error; err != nil {
		return err
	}
	if !totp.Validate(code, user.TOTPSecret) {
		return fmt.Errorf("invalid TOTP code")
	}
	return nil
}

// DisableTOTP disables TOTP for a user
func (s *Service) DisableTOTP(userID uint, code string) error {
	if err := s.ValidateTOTP(userID, code); err != nil {
		return err
	}
	return s.db.Model(&models.User{}).Where("id = ?", userID).
		Updates(map[string]interface{}{"totp_enabled": false, "totp_secret": ""}).Error
}

// --- JWT ---

// GenerateToken creates a JWT for an authenticated user
func (s *Service) GenerateToken(user *models.User) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:   user.ID,
		Username: user.Username,
		Role:     user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(s.jwtExpiry)),
			Issuer:    "wiregate",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.jwtSecret))
}

// ValidateToken validates a JWT and returns the claims
func (s *Service) ValidateToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(s.jwtSecret), nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return claims, nil
}

// --- API Keys ---

// CreateAPIKey generates a new API key for a user
func (s *Service) CreateAPIKey(userID uint, name, scopes string, expiresAt *time.Time) (string, *models.APIKey, error) {
	// Generate 32-byte random key
	rawKey := make([]byte, 32)
	if _, err := rand.Read(rawKey); err != nil {
		return "", nil, err
	}
	keyStr := "wg_" + hex.EncodeToString(rawKey)

	// Hash the key for storage
	hash, err := bcrypt.GenerateFromPassword([]byte(keyStr), bcrypt.MinCost)
	if err != nil {
		return "", nil, err
	}

	apiKey := &models.APIKey{
		Name:      name,
		KeyHash:   string(hash),
		KeyPrefix: keyStr[:10] + "...",
		UserID:    userID,
		Scopes:    scopes,
		ExpiresAt: expiresAt,
	}

	if err := s.db.Create(apiKey).Error; err != nil {
		return "", nil, err
	}

	return keyStr, apiKey, nil
}

// ValidateAPIKey validates an API key and returns the associated user
func (s *Service) ValidateAPIKey(key string) (*models.User, *models.APIKey, error) {
	if !strings.HasPrefix(key, "wg_") {
		return nil, nil, fmt.Errorf("invalid API key format")
	}

	// Fetch all non-expired API keys (we need to bcrypt-compare each)
	var keys []models.APIKey
	query := s.db.Preload("User")
	if err := query.Find(&keys).Error; err != nil {
		return nil, nil, err
	}

	for _, k := range keys {
		if k.ExpiresAt != nil && k.ExpiresAt.Before(time.Now()) {
			continue
		}
		if bcrypt.CompareHashAndPassword([]byte(k.KeyHash), []byte(key)) == nil {
			// Update last used
			now := time.Now()
			s.db.Model(&k).Update("last_used", now)
			return &k.User, &k, nil
		}
	}
	return nil, nil, fmt.Errorf("invalid or expired API key")
}

// --- User Management ---

// CreateInitialAdmin creates the first admin user if none exist
func (s *Service) CreateInitialAdmin(username, password string) (*models.User, error) {
	var count int64
	s.db.Model(&models.User{}).Count(&count)
	if count > 0 {
		return nil, fmt.Errorf("admin user already exists")
	}

	hash, err := HashPassword(password)
	if err != nil {
		return nil, err
	}

	user := &models.User{
		Username:     username,
		PasswordHash: hash,
		Role:         "admin",
	}
	if err := s.db.Create(user).Error; err != nil {
		return nil, err
	}
	return user, nil
}

// IsSetupRequired returns true if no users exist (first run)
func (s *Service) IsSetupRequired() bool {
	var count int64
	s.db.Model(&models.User{}).Count(&count)
	return count == 0
}

// UpdateLastLogin updates the user's last login timestamp
func (s *Service) UpdateLastLogin(userID uint) {
	now := time.Now()
	s.db.Model(&models.User{}).Where("id = ?", userID).Update("last_login", now)
}
