package httpserver

import (
	"context"
	"encoding/hex"
	"errors"
	"net/http"
	"net/mail"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/platform/email"
)

type NotificationEmailRepository interface {
	GetNotificationEmail(context.Context, string) (email.NotificationSettings, error)
	RequestNotificationEmail(context.Context, string, string) error
	VerifyNotificationEmail(context.Context, string, string) error
	UpdateNotificationEmail(context.Context, string, *bool, *bool) error
}

func (d DeliveryDependencies) notificationEmail(w http.ResponseWriter, r *http.Request) {
	user, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if d.NotificationEmail == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Email settings unavailable", "Email settings are unavailable")
		return
	}
	ctx := r.Context()
	settings, err := d.NotificationEmail.GetNotificationEmail(ctx, user)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Email settings unavailable", "Unable to load email settings")
		return
	}
	if r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, settings)
		return
	}
	if !settings.Available {
		writeProblem(w, http.StatusServiceUnavailable, "Email delivery unavailable", "No email provider is configured")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	switch r.Method {
	case http.MethodPost:
		if strings.HasSuffix(r.URL.Path, "/verify") {
			var body struct {
				Code string `json:"code"`
			}
			if !decodeJSON(w, r, &body) {
				return
			}
			code := strings.ToLower(strings.TrimSpace(body.Code))
			if _, parseErr := hex.DecodeString(code); len(code) != 48 || parseErr != nil {
				writeProblem(w, http.StatusUnprocessableEntity, "Invalid verification code", "Enter the code from the verification email")
				return
			}
			err = d.NotificationEmail.VerifyNotificationEmail(ctx, user, code)
		} else {
			var body struct {
				Address string `json:"address"`
			}
			if !decodeJSON(w, r, &body) {
				return
			}
			address := strings.TrimSpace(body.Address)
			parsed, parseErr := mail.ParseAddress(address)
			if len(address) > 254 || parseErr != nil || parsed.Address != address || strings.ContainsAny(address, "\r\n") {
				writeProblem(w, http.StatusUnprocessableEntity, "Invalid email address", "Enter a valid email address")
				return
			}
			err = d.NotificationEmail.RequestNotificationEmail(ctx, user, address)
		}
	case http.MethodPatch:
		var body struct {
			Participating *bool `json:"participating"`
			Watching      *bool `json:"watching"`
		}
		if !decodeJSON(w, r, &body) {
			return
		}
		if body.Participating == nil && body.Watching == nil {
			writeProblem(w, http.StatusUnprocessableEntity, "Invalid email preference", "Provide participating or watching")
			return
		}
		err = d.NotificationEmail.UpdateNotificationEmail(ctx, user, body.Participating, body.Watching)
	}
	switch {
	case errors.Is(err, email.ErrVerificationThrottled):
		w.Header().Set("Retry-After", "60")
		writeProblem(w, http.StatusTooManyRequests, "Verification requested too recently", "Wait one minute before requesting another code")
	case errors.Is(err, email.ErrVerificationInvalid):
		writeProblem(w, http.StatusUnprocessableEntity, "Invalid verification code", "The code is invalid or expired")
	case errors.Is(err, email.ErrAddressRequired):
		writeProblem(w, http.StatusConflict, "Verified email required", "Verify an email address before enabling delivery")
	case err != nil:
		writeProblem(w, http.StatusInternalServerError, "Email settings unavailable", "Unable to save email settings")
	default:
		settings, err = d.NotificationEmail.GetNotificationEmail(ctx, user)
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, "Email settings unavailable", "Unable to load email settings")
			return
		}
		writeJSON(w, http.StatusOK, settings)
	}
}
