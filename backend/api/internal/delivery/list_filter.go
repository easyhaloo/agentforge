package delivery

import (
	"slices"
	"strings"
)

// ListFilter narrows a changeset list. Every non-empty field must match (AND); the zero value
// matches everything.
type ListFilter struct {
	// Repository is an exact repository match.
	Repository string
	// Status matches the server-derived Changeset.Lifecycle().
	Status Lifecycle
	// Reviewer is a user id. It matches changesets whose CURRENT revision has a review assigned
	// to that user, whatever its decision; reviews of older revisions never match.
	Reviewer string
	// Query is a case-insensitive substring of the changeset id, title, repository or creator.
	Query string
}

// FilterAndPage applies filter to items, orders the matches by UpdatedAt descending then ID
// ascending, and returns the requested page together with the number of matches before paging.
//
// It is the single implementation of list matching and paging, shared by every Repository, so
// stores cannot diverge. Callers validate the page range; out-of-range input never panics: an
// offset past the end or a non-positive limit gives an empty page, and a negative offset counts
// as 0. The result is never nil and items is not modified.
func FilterAndPage(items []StoredChangeset, filter ListFilter, limit, offset int) ([]StoredChangeset, int) {
	query := strings.ToLower(strings.TrimSpace(filter.Query))
	matched := make([]StoredChangeset, 0, len(items))
	for _, item := range items {
		if filter.matches(item.Changeset, query) {
			matched = append(matched, item)
		}
	}
	slices.SortFunc(matched, func(a, b StoredChangeset) int {
		if byUpdate := b.UpdatedAt.Compare(a.UpdatedAt); byUpdate != 0 {
			return byUpdate
		}
		return strings.Compare(string(a.Changeset.ID), string(b.Changeset.ID))
	})

	total := len(matched)
	offset = min(max(offset, 0), total)
	end := total
	if limit < total-offset {
		end = offset + max(limit, 0)
	}
	return matched[offset:end], total
}

// matches reports whether c satisfies every non-empty field; query is already trimmed and lowered.
func (f ListFilter) matches(c *Changeset, query string) bool {
	if f.Repository != "" && c.Repository != f.Repository {
		return false
	}
	if f.Status != "" && c.Lifecycle() != f.Status {
		return false
	}
	if f.Reviewer != "" && !c.reviewAssignedTo(c.currentRevisionID(), f.Reviewer) {
		return false
	}
	if query == "" {
		return true
	}
	for _, field := range []string{string(c.ID), c.Title, c.Repository, c.CreatedBy} {
		if strings.Contains(strings.ToLower(field), query) {
			return true
		}
	}
	return false
}

func (c *Changeset) reviewAssignedTo(revisionID ID, reviewer string) bool {
	for _, review := range c.Reviews {
		if review.RevisionID == revisionID && review.Reviewer == reviewer {
			return true
		}
	}
	return false
}
