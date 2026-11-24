package email

import "errors"

var (
	ErrVerificationThrottled = errors.New("verification requested too recently")
	ErrVerificationInvalid   = errors.New("verification code is invalid or expired")
	ErrAddressRequired       = errors.New("verified notification address required")
)

type NotificationSettings struct {
	Available     bool   `json:"available"`
	Address       string `json:"address"`
	Pending       string `json:"pending_address"`
	Participating bool   `json:"participating"`
	Watching      bool   `json:"watching"`
}
