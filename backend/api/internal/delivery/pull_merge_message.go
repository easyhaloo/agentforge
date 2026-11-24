package delivery

import (
	"context"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
)

// PullMergeMessage uses persisted PR metadata. Clients cannot provide it in a merge request.
type PullMergeMessage struct {
	formats                         githttp.MergeMessageFormats
	title, description, source, ref string
}

func (c *Changeset) PullMergeMessage(formats githttp.MergeMessageFormats) *PullMergeMessage {
	if c.PullRequest == nil {
		return nil
	}
	return &PullMergeMessage{
		formats: formats, title: c.Title, description: c.PullRequest.Description,
		source: c.Repository + ":" + c.PullRequest.SourceBranch, ref: string(c.ID),
	}
}

func (m PullMergeMessage) render(ctx context.Context, dir, strategy, base, head string) (string, error) {
	title := strings.TrimSpace(strings.NewReplacer("\r\n", " ", "\r", " ", "\n", " ").Replace(m.title))
	var body string
	format := m.formats.MergeCommitMessageFormat
	if strategy == "squash" {
		format = m.formats.SquashCommitMessageFormat
		if format == "" || format == "default" || format == "commits" {
			commits, err := previewGit(ctx, dir, "log", "--reverse", "--format=%s", base+".."+head, "--")
			if err != nil {
				return "", ErrPreviewUnavailable
			}
			subjects := strings.Split(strings.TrimSuffix(string(commits), "\n"), "\n")
			if len(subjects) == 1 && subjects[0] != "" && format != "commits" {
				message, err := previewGit(ctx, dir, "show", "-s", "--format=%B", head, "--")
				if err != nil {
					return "", ErrPreviewUnavailable
				}
				return strings.TrimSpace(string(message)), nil
			}
			if subjects[0] != "" {
				body = "* " + strings.Join(subjects, "\n* ")
			}
		}
	} else if format == "" || format == "default" {
		body = title
		title = "Merge pull request " + m.ref + " from " + m.source
	}
	if format == "description" {
		body = strings.TrimSpace(m.description)
	}
	if body != "" {
		return title + "\n\n" + body, nil
	}
	return title, nil
}
