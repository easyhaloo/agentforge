package delivery

import "time"

// SetPRCommentResolution also accepts anchors from superseded revisions.
func (c *Changeset) SetPRCommentResolution(id ID, actor string, resolved bool, now time.Time) (bool, error) {
	if c == nil || c.PullRequest == nil || id == "" || actor == "" {
		return false, ErrNotFound
	}
	for i := range c.PullRequest.Comments {
		comment := &c.PullRequest.Comments[i]
		if comment.ID != id || comment.RevisionID == "" {
			continue
		}
		if comment.isResolved() == resolved {
			return false, nil
		}
		kind := "pull_request.conversation_reopened"
		comment.ResolvedBy, comment.ResolvedAt = "", nil
		if resolved {
			comment.ResolvedBy, comment.ResolvedAt = actor, &now
			kind = "pull_request.conversation_resolved"
		}
		c.record(actor, kind, id, "succeeded", now)
		return true, nil
	}
	return false, ErrNotFound
}

// HasUnresolvedPRConversations checks all inline comments, including outdated anchors.
func (c *Changeset) HasUnresolvedPRConversations() bool {
	if c == nil || c.PullRequest == nil {
		return false
	}
	for _, comment := range c.PullRequest.Comments {
		if comment.RevisionID != "" && !comment.isResolved() {
			return true
		}
	}
	return false
}

func (c PRComment) isResolved() bool {
	return c.ResolvedAt != nil && c.ResolvedBy != ""
}
