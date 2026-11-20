package labels

import (
	"context"
)

// Repository defines the persistence interface for labels
type Repository interface {
	// Create persists a new label in a repository
	// Name must be unique within the repository
	// Color must be a 6-digit hex code (validated)
	Create(ctx context.Context, organizationID string, label *Label) (*Label, error)

	// Get retrieves a label by ID
	Get(ctx context.Context, organizationID string, labelID ID) (*Label, error)

	// List retrieves labels with filtering
	List(ctx context.Context, organizationID string, filter ListFilter) ([]*Label, error)

	// Update updates an existing label (name, description, color)
	Update(ctx context.Context, organizationID string, label *Label) (*Label, error)

	// Delete removes a label (and all its issue associations)
	Delete(ctx context.Context, organizationID string, labelID ID) error

	// AddLabelToIssue associates a label with an issue
	AddLabelToIssue(ctx context.Context, organizationID string, issueID string, labelID ID) error

	// RemoveLabelFromIssue removes a label association from an issue
	RemoveLabelFromIssue(ctx context.Context, organizationID string, issueID string, labelID ID) error

	// GetLabelsForIssue retrieves all labels associated with an issue
	GetLabelsForIssue(ctx context.Context, organizationID string, issueID string) ([]*Label, error)
}
