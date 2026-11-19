package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/jackc/pgx/v5"
)

// ListSSHKeys retrieves all SSH keys for a user.
func (s *Store) ListSSHKeys(ctx context.Context, userID string) ([]identity.SSHKey, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("user ID is required")
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, title, key_type, key_bits, public_key,
		       fingerprint, created_at, last_used_at
		FROM ssh_keys
		WHERE user_id = $1
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list ssh keys: %w", err)
	}
	defer rows.Close()

	var keys []identity.SSHKey
	for rows.Next() {
		var key identity.SSHKey
		if err := rows.Scan(&key.KeyID, &key.UserID, &key.Title, &key.KeyType,
			&key.KeyBits, &key.PublicKey, &key.Fingerprint, &key.CreatedAt, &key.LastUsedAt); err != nil {
			return nil, fmt.Errorf("scan ssh key: %w", err)
		}
		keys = append(keys, key)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate ssh keys: %w", err)
	}

	return keys, nil
}

// AddSSHKey adds a new SSH public key for a user.
func (s *Store) AddSSHKey(ctx context.Context, userID, title, publicKey string) (identity.SSHKey, error) {
	if strings.TrimSpace(userID) == "" {
		return identity.SSHKey{}, errors.New("user ID is required")
	}
	if strings.TrimSpace(title) == "" {
		return identity.SSHKey{}, errors.New("title is required")
	}
	if strings.TrimSpace(publicKey) == "" {
		return identity.SSHKey{}, errors.New("public key is required")
	}

	// Parse and validate the SSH public key
	keyType, keyBits, fingerprint, err := parseSSHPublicKey(publicKey)
	if err != nil {
		return identity.SSHKey{}, fmt.Errorf("invalid SSH public key: %w", err)
	}

	// Check for duplicate fingerprint
	var existingKeyID string
	err = s.pool.QueryRow(ctx, `
		SELECT id FROM ssh_keys WHERE fingerprint = $1
	`, fingerprint).Scan(&existingKeyID)
	if err == nil {
		return identity.SSHKey{}, errors.New("SSH key already exists")
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return identity.SSHKey{}, fmt.Errorf("check duplicate key: %w", err)
	}

	// Generate key ID
	keyID, err := newSessionID()
	if err != nil {
		return identity.SSHKey{}, fmt.Errorf("generate key ID: %w", err)
	}

	now := time.Now().UTC()
	var key identity.SSHKey

	err = s.pool.QueryRow(ctx, `
		INSERT INTO ssh_keys (id, user_id, title, key_type, key_bits, public_key, fingerprint, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, user_id, title, key_type, key_bits, public_key, fingerprint, created_at, last_used_at
	`, keyID, userID, title, keyType, keyBits, publicKey, fingerprint, now).Scan(
		&key.KeyID, &key.UserID, &key.Title, &key.KeyType, &key.KeyBits,
		&key.PublicKey, &key.Fingerprint, &key.CreatedAt, &key.LastUsedAt,
	)

	if err != nil {
		return identity.SSHKey{}, fmt.Errorf("add ssh key: %w", err)
	}

	return key, nil
}

// DeleteSSHKey removes an SSH key.
func (s *Store) DeleteSSHKey(ctx context.Context, userID, keyID string) error {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(keyID) == "" {
		return errors.New("user ID and key ID are required")
	}

	tag, err := s.pool.Exec(ctx, `
		DELETE FROM ssh_keys WHERE id = $1 AND user_id = $2
	`, keyID, userID)
	if err != nil {
		return fmt.Errorf("delete ssh key: %w", err)
	}

	if tag.RowsAffected() == 0 {
		return errors.New("SSH key not found or does not belong to user")
	}

	return nil
}

// parseSSHPublicKey parses an SSH public key and returns its type, bit length, and SHA256 fingerprint.
// Supports RSA, Ed25519, and ECDSA keys in OpenSSH format.
func parseSSHPublicKey(publicKey string) (keyType string, keyBits int, fingerprint string, err error) {
	publicKey = strings.TrimSpace(publicKey)

	// SSH public key format: <key-type> <base64-encoded-key> [comment]
	parts := strings.Fields(publicKey)
	if len(parts) < 2 {
		return "", 0, "", errors.New("invalid SSH public key format")
	}

	keyTypeStr := parts[0]
	keyData := parts[1]

	// Decode base64 key data
	decoded, err := base64.StdEncoding.DecodeString(keyData)
	if err != nil {
		return "", 0, "", fmt.Errorf("invalid base64 encoding: %w", err)
	}

	// Calculate SHA256 fingerprint
	hash := sha256.Sum256(decoded)
	fingerprint = "SHA256:" + base64.RawStdEncoding.EncodeToString(hash[:])

	// Determine key type and approximate bit length
	switch keyTypeStr {
	case "ssh-rsa":
		keyType = "RSA"
		// RSA keys are typically 2048 or 4096 bits
		// We can estimate based on decoded length
		if len(decoded) < 400 {
			keyBits = 2048
		} else {
			keyBits = 4096
		}
	case "ssh-ed25519":
		keyType = "Ed25519"
		keyBits = 256
	case "ecdsa-sha2-nistp256":
		keyType = "ECDSA"
		keyBits = 256
	case "ecdsa-sha2-nistp384":
		keyType = "ECDSA"
		keyBits = 384
	case "ecdsa-sha2-nistp521":
		keyType = "ECDSA"
		keyBits = 521
	default:
		return "", 0, "", fmt.Errorf("unsupported key type: %s", keyTypeStr)
	}

	return keyType, keyBits, fingerprint, nil
}
