package identity

import "time"

// UserPreferences represents user appearance and localization settings.
type UserPreferences struct {
	UserID    string    `json:"user_id"`
	Theme     string    `json:"theme"`
	Language  string    `json:"language"`
	Timezone  string    `json:"timezone"`
	UpdatedAt time.Time `json:"updated_at"`
}

// NotificationPreferences represents user notification settings.
type NotificationPreferences struct {
	UserID                string                    `json:"user_id"`
	EmailNotifications    EmailNotificationSettings `json:"email_notifications"`
	WebPushEnabled        bool                      `json:"web_push_enabled"`
	NotificationFrequency string                    `json:"notification_frequency"`
	UpdatedAt             time.Time                 `json:"updated_at"`
}

// EmailNotificationSettings contains individual email notification toggles.
type EmailNotificationSettings struct {
	EvaluationComplete bool `json:"evaluation_complete"`
	ReviewAssigned     bool `json:"review_assigned"`
	ChangesetStatus    bool `json:"changeset_status"`
	OrgInvitation      bool `json:"org_invitation"`
}

// SSHKey represents an SSH public key.
type SSHKey struct {
	KeyID       string     `json:"key_id"`
	UserID      string     `json:"user_id"`
	Title       string     `json:"title"`
	KeyType     string     `json:"key_type"`
	KeyBits     int        `json:"key_bits"`
	PublicKey   string     `json:"public_key"`
	Fingerprint string     `json:"fingerprint"`
	CreatedAt   time.Time  `json:"created_at"`
	LastUsedAt  *time.Time `json:"last_used_at,omitempty"`
}

// SessionInfo represents a user session with metadata.
type SessionInfo struct {
	SessionID    string     `json:"session_id"`
	UserID       string     `json:"user_id"`
	DeviceType   string     `json:"device_type"`
	Browser      string     `json:"browser"`
	OS           string     `json:"os"`
	IPAddress    string     `json:"ip_address"`
	Location     *string    `json:"location,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	LastActiveAt time.Time  `json:"last_active_at"`
	IsCurrent    bool       `json:"is_current"`
}

// AgentPreferences represents AI agent behavior settings.
type AgentPreferences struct {
	UserID                  string      `json:"user_id"`
	OutputVerbosity         string      `json:"output_verbosity"`
	ConfirmationStrategy    string      `json:"confirmation_strategy"`
	AutomationLevel         string      `json:"automation_level"`
	CrossSessionMemory      bool        `json:"cross_session_memory_enabled"`
	AutoEvaluateOnPush      bool        `json:"auto_evaluate_on_push"`
	NotifyEvaluationResults bool        `json:"notify_evaluation_results"`
	EvaluationStrictness    string      `json:"evaluation_strictness"`
	AgentReviewEnabled      bool        `json:"agent_review_enabled"`
	AgentCanApproveLowRisk  bool        `json:"agent_can_approve_low_risk"`
	ReviewFocus             ReviewFocus `json:"review_focus"`
	UpdatedAt               time.Time   `json:"updated_at"`
}

// ReviewFocus contains flags for different review areas.
type ReviewFocus struct {
	Security      bool `json:"security"`
	Performance   bool `json:"performance"`
	CodeStyle     bool `json:"code_style"`
	TestCoverage  bool `json:"test_coverage"`
	Documentation bool `json:"documentation"`
}

// AuthenticationInfo represents authentication details for a user.
type AuthenticationInfo struct {
	OIDCProvider    string     `json:"oidc_provider"`
	OIDCProviderURL string     `json:"oidc_provider_url"`
	LoginEmail      string     `json:"login_email"`
	LastLoginAt     *time.Time `json:"last_login_at,omitempty"`
}
