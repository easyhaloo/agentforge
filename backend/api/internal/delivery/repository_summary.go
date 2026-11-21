package delivery

import (
	"bytes"
	"context"
	"path"
	"strconv"
	"strings"
	"time"
)

type RepositoryGitSummary struct {
	BranchCount int        `json:"branch_count"`
	LastCommit  *time.Time `json:"last_commit_at,omitempty"`
	Language    string     `json:"language,omitempty"`
}

type RepositoryGitSummarizer interface {
	SummarizeRepository(context.Context, string, string, string) (RepositoryGitSummary, error)
}

func (p *LocalGitProvider) SummarizeRepository(ctx context.Context, org, repository, defaultBranch string) (RepositoryGitSummary, error) {
	var summary RepositoryGitSummary
	dir, err := p.repositoryPath(ctx, org, repository)
	if err != nil {
		return summary, err
	}
	output, err := p.runPreview(ctx, dir, 1<<20, "for-each-ref", "--format=%(refname)%00%(objectname)%00%(committerdate:unix)", "refs/heads")
	if err != nil {
		return summary, err
	}
	var defaultSHA string
	for _, row := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		fields := strings.Split(row, "\x00")
		if len(fields) != 3 || !validGitObjectID(fields[1]) {
			continue
		}
		summary.BranchCount++
		if fields[0] == "refs/heads/"+defaultBranch {
			defaultSHA = fields[1]
		}
		if epoch, err := strconv.ParseInt(fields[2], 10, 64); err == nil {
			at := time.Unix(epoch, 0).UTC()
			if summary.LastCommit == nil || at.After(*summary.LastCommit) {
				summary.LastCommit = &at
			}
		}
	}
	if defaultSHA != "" {
		// ponytail: classify tracked source by extension and size; use Linguist if vendoring and ambiguous extensions need exact handling.
		if tree, err := p.runPreview(ctx, dir, 4<<20, "ls-tree", "-r", "-l", "-z", defaultSHA); err == nil {
			summary.Language = primaryRepositoryLanguage(tree)
		}
	}
	return summary, nil
}

var sourceLanguages = map[string]string{
	".go": "Go", ".rs": "Rust", ".py": "Python", ".rb": "Ruby", ".java": "Java", ".kt": "Kotlin",
	".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript",
	".c": "C", ".h": "C", ".cpp": "C++", ".cc": "C++", ".hpp": "C++", ".cs": "C#", ".swift": "Swift", ".dart": "Dart",
	".php": "PHP", ".scala": "Scala", ".vue": "Vue", ".svelte": "Svelte", ".sql": "SQL", ".lua": "Lua", ".sh": "Shell",
	".html": "HTML", ".css": "CSS", ".scss": "SCSS", ".ex": "Elixir", ".exs": "Elixir", ".zig": "Zig", ".r": "R",
}

func primaryRepositoryLanguage(tree []byte) string {
	weights := make(map[string]int64)
	for _, entry := range bytes.Split(tree, []byte{0}) {
		metadata, filename, ok := bytes.Cut(entry, []byte{'\t'})
		fields := strings.Fields(string(metadata))
		if !ok || len(fields) != 4 || (fields[0] != "100644" && fields[0] != "100755") {
			continue
		}
		name := strings.ToLower(string(filename))
		dirs := "/" + path.Dir(name) + "/"
		if strings.Contains(dirs, "/vendor/") || strings.Contains(dirs, "/node_modules/") || strings.Contains(dirs, "/dist/") || strings.HasSuffix(name, ".min.js") {
			continue
		}
		if language := sourceLanguages[path.Ext(name)]; language != "" {
			size, _ := strconv.ParseInt(fields[3], 10, 64)
			weights[language] += size
		}
	}
	var best string
	for language, weight := range weights {
		if weight > weights[best] || (weight > 0 && weight == weights[best] && language < best) {
			best = language
		}
	}
	return best
}
