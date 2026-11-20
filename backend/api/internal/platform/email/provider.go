package email

import (
	"context"
	"errors"
	"fmt"
)

var (
	ErrInvalidProvider = errors.New("invalid email provider")
	ErrSendFailed      = errors.New("email send failed")
)

// Message represents an email to be sent.
type Message struct {
	To      string
	Subject string
	Body    string
	IsHTML  bool
}

// Provider defines the interface for sending emails.
type Provider interface {
	Send(ctx context.Context, msg Message) error
}

// Config holds email provider configuration.
type Config struct {
	Provider string // "sendgrid" or "ses"
	From     string // sender email address

	// SendGrid configuration
	SendGridAPIKey string

	// AWS SES configuration
	SESRegion          string
	SESAccessKeyID     string
	SESSecretAccessKey string
}

// Validate checks if the configuration is valid.
func (c Config) Validate() error {
	if c.From == "" {
		return fmt.Errorf("from address is required")
	}

	switch c.Provider {
	case "sendgrid":
		if c.SendGridAPIKey == "" {
			return fmt.Errorf("SendGrid API key is required")
		}
		return nil
	case "ses":
		if c.SESRegion == "" {
			return fmt.Errorf("AWS SES region is required")
		}
		// AWS credentials can be provided via environment or IAM role
		return nil
	case "":
		return fmt.Errorf("email provider is required (sendgrid or ses)")
	default:
		return fmt.Errorf("%w: %s (must be sendgrid or ses)", ErrInvalidProvider, c.Provider)
	}
}

// NewProvider creates an email provider based on the configuration.
func NewProvider(cfg Config) (Provider, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	switch cfg.Provider {
	case "sendgrid":
		return NewSendGridProvider(cfg.SendGridAPIKey, cfg.From), nil
	case "ses":
		return NewSESProvider(cfg.SESRegion, cfg.SESAccessKeyID, cfg.SESSecretAccessKey, cfg.From), nil
	default:
		return nil, fmt.Errorf("%w: %s", ErrInvalidProvider, cfg.Provider)
	}
}
