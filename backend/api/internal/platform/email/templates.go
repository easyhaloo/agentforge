package email

import (
	"fmt"
	"html"
	"strings"
)

// Template defines an email template.
type Template struct {
	Subject string
	Body    string
	IsHTML  bool
}

// InvitationData contains data for rendering an invitation email.
type InvitationData struct {
	OrganizationName string
	InviterName      string
	Role             string
	InvitationURL    string
	ExpiresInDays    int
}

// RenderInvitation renders an invitation email from the given data.
func RenderInvitation(data InvitationData) Template {
	subject := fmt.Sprintf("Invitation to join %s on AgentForge", data.OrganizationName)

	body := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>%s</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #f8f9fa; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
        <h1 style="margin: 0 0 20px 0; font-size: 24px; font-weight: 600; color: #1a1a1a;">
            You've been invited to join %s
        </h1>
        <p style="margin: 0 0 15px 0; font-size: 16px; color: #555;">
            %s has invited you to join <strong>%s</strong> as a <strong>%s</strong> on AgentForge.
        </p>
        <p style="margin: 0 0 25px 0; font-size: 14px; color: #666;">
            AgentForge is an agent-native source control and verified change platform that helps teams deliver with confidence.
        </p>
        <a href="%s" style="display: inline-block; background-color: #0066cc; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 16px; font-weight: 500;">
            Accept Invitation
        </a>
    </div>
    <div style="padding: 20px; font-size: 14px; color: #666;">
        <p style="margin: 0 0 10px 0;">
            <strong>Note:</strong> This invitation will expire in %d days.
        </p>
        <p style="margin: 0 0 10px 0;">
            If the button above doesn't work, copy and paste this link into your browser:
        </p>
        <p style="margin: 0; word-break: break-all; color: #0066cc;">
            %s
        </p>
    </div>
    <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; margin-top: 20px; font-size: 12px; color: #999; text-align: center;">
        <p style="margin: 0;">
            If you didn't expect this invitation, you can safely ignore this email.
        </p>
    </div>
</body>
</html>`,
		html.EscapeString(subject),
		html.EscapeString(data.OrganizationName),
		html.EscapeString(data.InviterName),
		html.EscapeString(data.OrganizationName),
		html.EscapeString(data.Role),
		html.EscapeString(data.InvitationURL),
		data.ExpiresInDays,
		html.EscapeString(data.InvitationURL),
	)

	return Template{
		Subject: subject,
		Body:    body,
		IsHTML:  true,
	}
}

// RenderInvitationPlainText renders a plain-text invitation email.
func RenderInvitationPlainText(data InvitationData) Template {
	subject := fmt.Sprintf("Invitation to join %s on AgentForge", data.OrganizationName)

	body := strings.TrimSpace(fmt.Sprintf(`
You've been invited to join %s

%s has invited you to join %s as a %s on AgentForge.

AgentForge is an agent-native source control and verified change platform that helps teams deliver with confidence.

Accept your invitation by visiting:
%s

Note: This invitation will expire in %d days.

If you didn't expect this invitation, you can safely ignore this email.
`,
		data.OrganizationName,
		data.InviterName,
		data.OrganizationName,
		data.Role,
		data.InvitationURL,
		data.ExpiresInDays,
	))

	return Template{
		Subject: subject,
		Body:    body,
		IsHTML:  false,
	}
}
