package email

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// SendGridProvider implements email sending via SendGrid API.
type SendGridProvider struct {
	apiKey string
	from   string
	client *http.Client
}

// NewSendGridProvider creates a new SendGrid email provider.
func NewSendGridProvider(apiKey, from string) *SendGridProvider {
	return &SendGridProvider{
		apiKey: apiKey,
		from:   from,
		client: &http.Client{},
	}
}

type sendGridPayload struct {
	Personalizations []sendGridPersonalization `json:"personalizations"`
	From             sendGridEmail             `json:"from"`
	Subject          string                    `json:"subject"`
	Content          []sendGridContent         `json:"content"`
}

type sendGridPersonalization struct {
	To []sendGridEmail `json:"to"`
}

type sendGridEmail struct {
	Email string `json:"email"`
}

type sendGridContent struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

// Send sends an email via SendGrid API v3.
func (s *SendGridProvider) Send(ctx context.Context, msg Message) error {
	contentType := "text/plain"
	if msg.IsHTML {
		contentType = "text/html"
	}

	payload := sendGridPayload{
		Personalizations: []sendGridPersonalization{
			{To: []sendGridEmail{{Email: msg.To}}},
		},
		From:    sendGridEmail{Email: s.from},
		Subject: msg.Subject,
		Content: []sendGridContent{
			{Type: contentType, Value: msg.Body},
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal SendGrid payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.sendgrid.com/v3/mail/send", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create SendGrid request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+s.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrSendFailed, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("%w: SendGrid returned status %d", ErrSendFailed, resp.StatusCode)
	}

	return nil
}
