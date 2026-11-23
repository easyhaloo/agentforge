package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
)

func githubItemURL(raw string) (repo, kind string, number int, ok bool) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host != "github.com" || parsed.User != nil ||
		parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || parsed.RawPath != "" {
		return "", "", 0, false
	}
	parts := strings.Split(strings.TrimPrefix(parsed.Path, "/"), "/")
	if len(parts) != 4 {
		return "", "", 0, false
	}
	repo, kind = parts[0]+"/"+parts[1], parts[2]
	n, err := strconv.ParseInt(parts[3], 10, 32)
	return repo, kind, int(n), err == nil && n > 0 && (kind == "issues" || kind == "pull") && validGitHubIssueRepo(repo)
}

func (d DeliveryDependencies) issueGitHubSource(w http.ResponseWriter, r *http.Request) {
	write := r.Method == http.MethodPut
	scope, ok := d.issueDetailScope(w, r, write)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	if write && !scope.CanManage {
		issueDetailError(w, issues.ErrDetailForbidden)
		return
	}
	current, err := d.IssueDetailRepo.GitHubSource(r.Context(), scope)
	if issueDetailError(w, err) {
		return
	}
	if !write {
		writeJSON(w, http.StatusOK, current)
		return
	}
	var request struct {
		URL      *string `json:"url"`
		Expected string  `json:"expected_fetched_at"`
	}
	if !decodeJSON(w, r, &request) {
		return
	}
	if request.URL == nil {
		writeProblem(w, http.StatusBadRequest, "GitHub issue URL required", "Use an empty URL to unlink a source")
		return
	}
	if len(*request.URL) > 200 {
		writeProblem(w, http.StatusBadRequest, "Invalid GitHub issue URL", "The URL can contain at most 200 bytes")
		return
	}
	var source *issues.GitHubSource
	if input := strings.TrimSpace(*request.URL); input != "" {
		repository, kind, number, ok := githubItemURL(input)
		if !ok || kind != "issues" {
			writeProblem(w, http.StatusBadRequest, "Invalid GitHub issue URL", "Enter a public GitHub issue URL")
			return
		}
		var status int
		client := *githubIssueClient
		client.Timeout = 8 * time.Second
		source, status = fetchIssueGitHubSource(r.Context(), &client, repository, number)
		if status != http.StatusOK {
			writeProblem(w, status, "GitHub issue unavailable", "The public GitHub issue and timeline could not be read")
			return
		}
	}
	err = d.IssueDetailRepo.SetGitHubSource(r.Context(), scope, source, request.Expected)
	if errors.Is(err, issues.ErrSourceConflict) {
		writeProblem(w, http.StatusConflict, "GitHub source changed", "Reload the issue to see the current GitHub source")
		return
	}
	if !issueDetailError(w, err) {
		writeJSON(w, http.StatusOK, source)
	}
}

func fetchIssueGitHubSource(ctx context.Context, client *http.Client, repository string, number int) (*issues.GitHubSource, int) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	ref, status := githubIssueReferenceFor(ctx, client, repository, number)
	if status != http.StatusOK {
		return nil, status
	}
	if ref.Kind != "issues" {
		return nil, http.StatusNotFound
	}
	path := "/" + repository + "/issues/" + strconv.Itoa(number)
	source := &issues.GitHubSource{URL: "https://github.com" + path, FetchedAt: time.Now().UTC(), References: []issues.GitHubReference{}}
	for page := 1; ; page++ {
		// Only follow the pagination relation, never a URL from the upstream header.
		next, err := appendGitHubTimelinePage(ctx, client, "https://api.github.com/repos"+path+"/timeline?per_page=100&page="+strconv.Itoa(page), source)
		if err != nil {
			return nil, http.StatusServiceUnavailable
		}
		if !next {
			return source, http.StatusOK
		}
	}
}

func appendGitHubTimelinePage(ctx context.Context, client *http.Client, endpoint string, source *issues.GitHubSource) (bool, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return false, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	response, err := client.Do(request)
	if err != nil {
		return false, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return false, errors.New("GitHub timeline request failed")
	}
	var timeline []struct {
		Event     string    `json:"event"`
		CreatedAt time.Time `json:"created_at"`
		Actor     struct {
			Login string `json:"login"`
		} `json:"actor"`
		Source struct {
			Issue struct {
				URL   string `json:"html_url"`
				Title string `json:"title"`
			} `json:"issue"`
		} `json:"source"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 8<<20)).Decode(&timeline); err != nil {
		return false, err
	}
	for _, event := range timeline {
		item := event.Source.Issue
		if event.Event != "cross-referenced" || event.CreatedAt.IsZero() {
			continue
		}
		if _, _, number, ok := githubItemURL(item.URL); ok {
			source.References = append(source.References, issues.GitHubReference{
				URL: item.URL, Title: item.Title, Number: number, Actor: event.Actor.Login, CreatedAt: event.CreatedAt,
			})
		}
	}
	for _, header := range response.Header.Values("Link") {
		for _, link := range strings.Split(header, ",") {
			if strings.HasSuffix(strings.TrimSpace(link), `; rel="next"`) {
				return true, nil
			}
		}
	}
	return false, nil
}
