package email

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/ses"
	"github.com/aws/aws-sdk-go-v2/service/ses/types"
)

// SESProvider implements email sending via AWS Simple Email Service.
type SESProvider struct {
	client *ses.Client
	from   string
}

// NewSESProvider creates a new AWS SES email provider.
func NewSESProvider(region, accessKeyID, secretAccessKey, from string) *SESProvider {
	var cfg aws.Config
	var err error

	if accessKeyID != "" && secretAccessKey != "" {
		// Use explicit credentials
		cfg, err = config.LoadDefaultConfig(context.Background(),
			config.WithRegion(region),
			config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
				accessKeyID,
				secretAccessKey,
				"",
			)),
		)
	} else {
		// Use default credential chain (environment, IAM role, etc.)
		cfg, err = config.LoadDefaultConfig(context.Background(),
			config.WithRegion(region),
		)
	}

	if err != nil {
		// This is best-effort initialization; actual errors surface on Send
		return &SESProvider{from: from}
	}

	return &SESProvider{
		client: ses.NewFromConfig(cfg),
		from:   from,
	}
}

// Send sends an email via AWS SES.
func (s *SESProvider) Send(ctx context.Context, msg Message) error {
	if s.client == nil {
		return fmt.Errorf("%w: SES client not initialized", ErrSendFailed)
	}

	var body types.Body
	if msg.IsHTML {
		body = types.Body{
			Html: &types.Content{
				Data:    aws.String(msg.Body),
				Charset: aws.String("UTF-8"),
			},
		}
	} else {
		body = types.Body{
			Text: &types.Content{
				Data:    aws.String(msg.Body),
				Charset: aws.String("UTF-8"),
			},
		}
	}

	input := &ses.SendEmailInput{
		Source: aws.String(s.from),
		Destination: &types.Destination{
			ToAddresses: []string{msg.To},
		},
		Message: &types.Message{
			Subject: &types.Content{
				Data:    aws.String(msg.Subject),
				Charset: aws.String("UTF-8"),
			},
			Body: &body,
		},
	}

	_, err := s.client.SendEmail(ctx, input)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrSendFailed, err)
	}

	return nil
}
