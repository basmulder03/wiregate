package middleware

import (
	"net/http"
	"strings"

	"github.com/basmulder03/wiregate/internal/auth"
	"github.com/gin-gonic/gin"
)

// AuthMiddleware validates JWT or API key from Authorization header
func AuthMiddleware(authSvc *auth.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "authorization header required"})
			return
		}

		// Support both "Bearer <jwt>" and "ApiKey <key>"
		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid authorization header"})
			return
		}

		scheme := strings.ToLower(parts[0])
		token := parts[1]

		switch scheme {
		case "bearer":
			claims, err := authSvc.ValidateToken(token)
			if err != nil {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired token"})
				return
			}
			c.Set("user_id", claims.UserID)
			c.Set("username", claims.Username)
			c.Set("role", claims.Role)
			c.Set("auth_type", "jwt")

		case "apikey":
			user, apiKey, err := authSvc.ValidateAPIKey(token)
			if err != nil {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired API key"})
				return
			}
			c.Set("user_id", user.ID)
			c.Set("username", user.Username)
			c.Set("role", user.Role)
			c.Set("auth_type", "api_key")
			c.Set("api_key_id", apiKey.ID)
			c.Set("api_key_scopes", apiKey.Scopes)

		default:
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unsupported auth scheme"})
			return
		}

		c.Next()
	}
}

// RequireAdmin ensures the authenticated user has admin role
func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, _ := c.Get("role")
		if role != "admin" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "admin role required"})
			return
		}
		c.Next()
	}
}

// RequireScope checks if an API key has the required scope
func RequireScope(scope string) gin.HandlerFunc {
	return func(c *gin.Context) {
		authType, _ := c.Get("auth_type")
		// JWT tokens have all scopes
		if authType == "jwt" {
			c.Next()
			return
		}
		// Check API key scopes
		scopes, _ := c.Get("api_key_scopes")
		if scopesStr, ok := scopes.(string); ok {
			for _, s := range strings.Split(scopesStr, ",") {
				if strings.TrimSpace(s) == scope || strings.TrimSpace(s) == "write" {
					c.Next()
					return
				}
			}
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "insufficient scope"})
	}
}
