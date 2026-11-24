package delivery

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
)

// MergeCommitMessage is the editable title and body of a native merge commit.
type MergeCommitMessage struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

func (m MergeCommitMessage) Text() (string, bool) {
	title := strings.TrimSpace(m.Title)
	if title == "" || strings.ContainsAny(m.Title, "\r\n\x00") || utf8.RuneCountInString(title) > 500 ||
		strings.ContainsRune(m.Body, 0) || utf8.RuneCountInString(m.Body) > 65536 {
		return "", false
	}
	body := strings.Trim(strings.ReplaceAll(m.Body, "\r\n", "\n"), "\n")
	if strings.TrimSpace(body) == "" {
		return title, true
	}
	return title + "\n\n" + body, true
}

// PullMergeMessage renders the repository's default or an explicit message.
type PullMergeMessage struct {
	formats                         githttp.MergeMessageFormats
	custom                          string
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

func (m *PullMergeMessage) SetCustomMessage(message string) {
	m.custom = message
}

func (p *LocalGitProvider) DefaultPullMergeMessage(ctx context.Context, org, repository, strategy, base, head string, message *PullMergeMessage) (MergeCommitMessage, error) {
	if !objectID.MatchString(base) || !objectID.MatchString(head) || message == nil {
		return MergeCommitMessage{}, ErrRepositoryInvalid
	}
	path, err := p.repositoryPath(ctx, org, repository)
	if err != nil {
		return MergeCommitMessage{}, err
	}
	text, err := message.render(ctx, path, strategy, base, head)
	if err != nil {
		return MergeCommitMessage{}, err
	}
	title, body, _ := strings.Cut(text, "\n")
	return MergeCommitMessage{Title: title, Body: strings.TrimPrefix(body, "\n")}, nil
}

func (m PullMergeMessage) render(ctx context.Context, dir, strategy, base, head string) (string, error) {
	if m.custom != "" {
		return m.custom, nil
	}
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
