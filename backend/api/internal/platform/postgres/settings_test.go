package postgres

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

func TestUserPreferences(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	store, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	// Create a test user
	userID, _, err := store.CreateOrUpdateLocalUser(ctx, "prefs@example.com", "password123", "Prefs User")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	t.Run("GetUserPreferences creates defaults", func(t *testing.T) {
		prefs, err := store.GetUserPreferences(ctx, userID)
		if err != nil {
			t.Fatalf("GetUserPreferences failed: %v", err)
		}

		if prefs.Theme != "auto" {
			t.Errorf("expected theme 'auto', got %q", prefs.Theme)
		}
		if prefs.Language != "en-US" {
			t.Errorf("expected language 'en-US', got %q", prefs.Language)
		}
		if prefs.Timezone != "UTC" {
			t.Errorf("expected timezone 'UTC', got %q", prefs.Timezone)
		}
	})

	t.Run("UpdateUserPreferences", func(t *testing.T) {
		prefs, err := store.UpdateUserPreferences(ctx, userID, "dark", "zh-CN", "Asia/Shanghai")
		if err != nil {
			t.Fatalf("UpdateUserPreferences failed: %v", err)
		}

		if prefs.Theme != "dark" {
			t.Errorf("expected theme 'dark', got %q", prefs.Theme)
		}
		if prefs.Language != "zh-CN" {
			t.Errorf("expected language 'zh-CN', got %q", prefs.Language)
		}
		if prefs.Timezone != "Asia/Shanghai" {
			t.Errorf("expected timezone 'Asia/Shanghai', got %q", prefs.Timezone)
		}

		// Verify the update persisted
		prefs, err = store.GetUserPreferences(ctx, userID)
		if err != nil {
			t.Fatalf("GetUserPreferences after update failed: %v", err)
		}

		if prefs.Theme != "dark" {
			t.Errorf("expected persisted theme 'dark', got %q", prefs.Theme)
		}
	})
}

func TestNotificationPreferences(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	store, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	// Create a test user
	userID, _, err := store.CreateOrUpdateLocalUser(ctx, "notifs@example.com", "password123", "Notifs User")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	t.Run("GetNotificationPreferences creates defaults", func(t *testing.T) {
		prefs, err := store.GetNotificationPreferences(ctx, userID)
		if err != nil {
			t.Fatalf("GetNotificationPreferences failed: %v", err)
		}

		if !prefs.EmailNotifications.EvaluationComplete {
			t.Error("expected evaluation_complete to be true by default")
		}
		if prefs.NotificationFrequency != "real-time" {
			t.Errorf("expected frequency 'real-time', got %q", prefs.NotificationFrequency)
		}
	})

	t.Run("UpdateNotificationPreferences", func(t *testing.T) {
		emailSettings := identity.EmailNotificationSettings{
			EvaluationComplete: false,
			ReviewAssigned:     true,
			ChangesetStatus:    false,
			OrgInvitation:      true,
		}

		prefs, err := store.UpdateNotificationPreferences(ctx, userID, emailSettings, true, "daily")
		if err != nil {
			t.Fatalf("UpdateNotificationPreferences failed: %v", err)
		}

		if prefs.EmailNotifications.EvaluationComplete {
			t.Error("expected evaluation_complete to be false")
		}
		if !prefs.WebPushEnabled {
			t.Error("expected web_push_enabled to be true")
		}
		if prefs.NotificationFrequency != "daily" {
			t.Errorf("expected frequency 'daily', got %q", prefs.NotificationFrequency)
		}
	})
}

func TestSSHKeys(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	store, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	// Create a test user
	userID, _, err := store.CreateOrUpdateLocalUser(ctx, "ssh@example.com", "password123", "SSH User")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	// Valid test SSH keys
	ed25519Key := "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOM+E9z0B7YBkSl0J5hRwNGWvAOCEHp6Z1yNB9FbVbL3 test@example.com"
	rsaKey := "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC7Z9j7WLtMX6NB1KR8cFN9wVvqoTHp6E5yPq9N3g8LxK9kHp6Y5W3+8YzL9+P8X7L8z9N6L8K9H7P6Y5W3+8YzL9+P8X7L8z9N6L8K9H7P6Y5W3+8YzL9+P8X7L8z9N6L8K9H7P6Y5W3+8YzL9+P8X7L8z9N6L8K9H7P6Y5W3+8YzL9+P8X7L8z9N6L8K9H7P6Y5W3+8YzL9+P8X7L8z9N6L8K9H7P6Y5W3+8YzL9+P8X7L8z9N6L8K9H7P6Y5W3+8YzL9+P8X7L8z9N6L8K9H7P6Y5W3+8YzL9+P8X7L8z9N6L8K9H7P6Y5W3+8YzL9+P8X7L8z9N6L8K9H7P6Y5W3+8YzL9+P8X7L8z9N6L8K9H test@example.com"

	t.Run("AddSSHKey", func(t *testing.T) {
		key, err := store.AddSSHKey(ctx, userID, "My Ed25519 Key", ed25519Key)
		if err != nil {
			t.Fatalf("AddSSHKey failed: %v", err)
		}

		if key.KeyType != "Ed25519" {
			t.Errorf("expected key type 'Ed25519', got %q", key.KeyType)
		}
		if key.KeyBits != 256 {
			t.Errorf("expected key bits 256, got %d", key.KeyBits)
		}
		if key.Title != "My Ed25519 Key" {
			t.Errorf("expected title 'My Ed25519 Key', got %q", key.Title)
		}
		if key.Fingerprint == "" {
			t.Error("expected non-empty fingerprint")
		}
	})

	t.Run("ListSSHKeys", func(t *testing.T) {
		keys, err := store.ListSSHKeys(ctx, userID)
		if err != nil {
			t.Fatalf("ListSSHKeys failed: %v", err)
		}

		if len(keys) != 1 {
			t.Errorf("expected 1 key, got %d", len(keys))
		}

		if len(keys) > 0 && keys[0].KeyType != "Ed25519" {
			t.Errorf("expected key type 'Ed25519', got %q", keys[0].KeyType)
		}
	})

	t.Run("AddDuplicateKey", func(t *testing.T) {
		_, err := store.AddSSHKey(ctx, userID, "Duplicate Key", ed25519Key)
		if err == nil {
			t.Error("expected error when adding duplicate key")
		}
	})

	t.Run("DeleteSSHKey", func(t *testing.T) {
		// Get the key ID
		keys, err := store.ListSSHKeys(ctx, userID)
		if err != nil || len(keys) == 0 {
			t.Fatalf("failed to get keys for deletion test: %v", err)
		}

		keyID := keys[0].KeyID

		err = store.DeleteSSHKey(ctx, userID, keyID)
		if err != nil {
			t.Fatalf("DeleteSSHKey failed: %v", err)
		}

		// Verify deletion
		keys, err = store.ListSSHKeys(ctx, userID)
		if err != nil {
			t.Fatalf("ListSSHKeys after delete failed: %v", err)
		}

		if len(keys) != 0 {
			t.Errorf("expected 0 keys after deletion, got %d", len(keys))
		}
	})
}

func TestAgentPreferences(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	store, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	// Create a test user
	userID, _, err := store.CreateOrUpdateLocalUser(ctx, "agent@example.com", "password123", "Agent User")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	t.Run("GetAgentPreferences creates defaults", func(t *testing.T) {
		prefs, err := store.GetAgentPreferences(ctx, userID)
		if err != nil {
			t.Fatalf("GetAgentPreferences failed: %v", err)
		}

		if prefs.OutputVerbosity != "standard" {
			t.Errorf("expected verbosity 'standard', got %q", prefs.OutputVerbosity)
		}
		if prefs.AutomationLevel != "balanced" {
			t.Errorf("expected automation 'balanced', got %q", prefs.AutomationLevel)
		}
		if !prefs.ReviewFocus.Security {
			t.Error("expected security focus to be true by default")
		}
	})

	t.Run("UpdateAgentPreferences", func(t *testing.T) {
		prefs := identity.AgentPreferences{
			OutputVerbosity:      "verbose",
			ConfirmationStrategy: "always",
			AutomationLevel:      "conservative",
			CrossSessionMemory:   false,
			ReviewFocus: identity.ReviewFocus{
				Security:      true,
				Performance:   false,
				CodeStyle:     true,
				TestCoverage:  false,
				Documentation: true,
			},
		}

		updated, err := store.UpdateAgentPreferences(ctx, userID, prefs)
		if err != nil {
			t.Fatalf("UpdateAgentPreferences failed: %v", err)
		}

		if updated.OutputVerbosity != "verbose" {
			t.Errorf("expected verbosity 'verbose', got %q", updated.OutputVerbosity)
		}
		if updated.ReviewFocus.CodeStyle != true {
			t.Error("expected code_style focus to be true")
		}
		if updated.ReviewFocus.Performance != false {
			t.Error("expected performance focus to be false")
		}
	})
}

func TestSessionsManagement(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	store, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	// Create a test user
	userID, _, err := store.CreateOrUpdateLocalUser(ctx, "sessions@example.com", "password123", "Sessions User")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	// Create some test sessions
	session1, err := identity.GenerateToken()
	if err != nil {
		t.Fatalf("failed to generate session: %v", err)
	}
	session2, err := identity.GenerateToken()
	if err != nil {
		t.Fatalf("failed to generate session: %v", err)
	}

	expiresAt := time.Now().Add(24 * time.Hour)

	_, err = store.CreateSession(ctx, userID, session1, "csrf1", expiresAt)
	if err != nil {
		t.Fatalf("failed to create session 1: %v", err)
	}

	_, err = store.CreateSession(ctx, userID, session2, "csrf2", expiresAt)
	if err != nil {
		t.Fatalf("failed to create session 2: %v", err)
	}

	t.Run("ListSessions", func(t *testing.T) {
		sessions, err := store.ListSessions(ctx, userID, session1)
		if err != nil {
			t.Fatalf("ListSessions failed: %v", err)
		}

		if len(sessions) != 2 {
			t.Errorf("expected 2 sessions, got %d", len(sessions))
		}

		// Check that one is marked as current
		currentCount := 0
		for _, s := range sessions {
			if s.IsCurrent {
				currentCount++
			}
		}
		if currentCount != 1 {
			t.Errorf("expected 1 current session, got %d", currentCount)
		}
	})

	t.Run("RevokeAllOtherSessions", func(t *testing.T) {
		count, err := store.RevokeAllOtherSessions(ctx, userID, session1)
		if err != nil {
			t.Fatalf("RevokeAllOtherSessions failed: %v", err)
		}

		if count != 1 {
			t.Errorf("expected 1 session revoked, got %d", count)
		}

		// Verify only one session remains active
		sessions, err := store.ListSessions(ctx, userID, session1)
		if err != nil {
			t.Fatalf("ListSessions after revoke failed: %v", err)
		}

		if len(sessions) != 1 {
			t.Errorf("expected 1 active session, got %d", len(sessions))
		}
	})
}

func TestAuthenticationInfo(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	store, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	// Create a test user with platform credentials
	userID, _, err := store.CreateOrUpdateLocalUser(ctx, "auth-info@example.com", "password123", "Auth Info User")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	t.Run("GetAuthenticationInfo", func(t *testing.T) {
		info, err := store.GetAuthenticationInfo(ctx, userID)
		if err != nil {
			t.Fatalf("GetAuthenticationInfo failed: %v", err)
		}

		if info.OIDCProvider != "platform:internal" {
			t.Errorf("expected provider 'platform:internal', got %q", info.OIDCProvider)
		}
		if info.LoginEmail != "auth-info@example.com" {
			t.Errorf("expected email 'auth-info@example.com', got %q", info.LoginEmail)
		}
	})
}
