package identity

type OrganizationSummary struct {
	ID string `json:"id"`
	Name string `json:"name"`
	Role string `json:"role"`
}

type AccountContext struct {
	UserID string `json:"user_id"`
	DisplayName string `json:"display_name"`
	Email string `json:"email,omitempty"`
	Organizations []OrganizationSummary `json:"organizations"`
}
