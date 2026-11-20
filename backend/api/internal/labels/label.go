package labels

import (
	"time"
)

// ID is a unique identifier for a label
type ID string

// Label represents a repository-scoped label that can be attached to issues
type Label struct {
	ID          ID
	Repository  string
	Name        string
	Description string
	Color       string // 6-digit hex color without # prefix (e.g., "d73a4a")
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// ListFilter represents filtering criteria for labels
type ListFilter struct {
	Repository string // Filter by repository (required)
	Query      string // Search in name and description
}
