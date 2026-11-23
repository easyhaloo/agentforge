package httpserver

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var githubIssueRepo = regexp.MustCompile(`^[a-zA-Z0-9-]{1,39}/[a-zA-Z0-9_.-]{1,100}$`)

var githubPullKeyword = regexp.MustCompile(`^[\p{L}\p{N}_.+-]{0,80}$`)

func validGitHubIssueRepo(repo string) bool {
	_, name, _ := strings.Cut(repo, "/")
	return githubIssueRepo.MatchString(repo) && name != "." && name != ".."
}

var githubIssueClient = &http.Client{
	Timeout:       2 * time.Second,
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

// resolveGitHubIssueReference forwards only an explicit public GitHub repository and number.
func (d DeliveryDependencies) resolveGitHubIssueReference(w http.ResponseWriter, r *http.Request) {
	if _, ok := d.principal(w, r, false); !ok {
		return
	}
	query := r.URL.Query()
	repo := query.Get("repository")
	number, err := strconv.ParseInt(query.Get("number"), 10, 32)
	if err != nil || number < 1 || !validGitHubIssueRepo(repo) {
		writeProblem(w, http.StatusBadRequest, "Invalid GitHub reference", "A GitHub repository and a positive number are required")
		return
	}
	reference, status := githubIssueReferenceFor(r.Context(), githubIssueClient, repo, int(number))
	switch status {
	case http.StatusOK:
		w.Header().Set("Cache-Control", "private, max-age=60")
		writeJSON(w, status, reference)
	case http.StatusNotFound:
		writeProblem(w, status, "GitHub reference not found", "No public issue or pull request was found")
	default:
		writeProblem(w, status, "GitHub reference unavailable", "The reference could not be resolved")
	}
}

type githubIssueReference struct {
	Kind  string `json:"kind"`
	Title string `json:"title"`
	State string `json:"state"`
}

func githubIssueReferenceFor(ctx context.Context, client *http.Client, repo string, number int) (githubIssueReference, int) {
	url := "https://api.github.com/repos/" + repo + "/issues/" + strconv.Itoa(number)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return githubIssueReference{}, http.StatusServiceUnavailable
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	res, err := client.Do(req)
	if err != nil {
		return githubIssueReference{}, http.StatusServiceUnavailable
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusGone {
		return githubIssueReference{}, http.StatusNotFound
	}
	if res.StatusCode != http.StatusOK {
		return githubIssueReference{}, http.StatusServiceUnavailable
	}
	var payload struct {
		Number      int    `json:"number"`
		Title       string `json:"title"`
		State       string `json:"state"`
		PullRequest *struct {
			MergedAt *time.Time `json:"merged_at"`
		} `json:"pull_request"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&payload); err != nil || payload.Number != number {
		return githubIssueReference{}, http.StatusServiceUnavailable
	}
	if payload.Title == "" || (payload.State != "open" && payload.State != "closed") {
		return githubIssueReference{}, http.StatusServiceUnavailable
	}
	reference := githubIssueReference{Kind: "issues", Title: payload.Title, State: payload.State}
	if payload.PullRequest != nil {
		reference.Kind = "pull"
		if payload.PullRequest.MergedAt != nil {
			reference.State = "merged"
		}
	}
	return reference, http.StatusOK
}

type githubPullReference struct {
	Number int    `json:"number"`
	Title  string `json:"title"`
}

func (d DeliveryDependencies) searchGitHubPullReferences(w http.ResponseWriter, r *http.Request) {
	if _, ok := d.principal(w, r, false); !ok {
		return
	}
	repo, keyword := r.URL.Query().Get("repository"), r.URL.Query().Get("q")
	if !validGitHubIssueRepo(repo) || !githubPullKeyword.MatchString(keyword) {
		writeProblem(w, http.StatusBadRequest, "Invalid GitHub pull request search", "Use a public owner/repository and an optional title keyword or number")
		return
	}
	items, status := githubPullReferencesFor(r.Context(), githubIssueClient, repo, keyword)
	if status != http.StatusOK {
		writeProblem(w, status, "GitHub pull requests unavailable", "The public repository could not be searched")
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=60")
	writeJSON(w, status, struct {
		Items []githubPullReference `json:"items"`
	}{items})
}

func githubPullReferencesFor(ctx context.Context, client *http.Client, repo, keyword string) ([]githubPullReference, int) {
	items := make([]githubPullReference, 0, 6)
	if number, err := strconv.ParseInt(keyword, 10, 32); err == nil && number > 0 {
		item, status := githubIssueReferenceFor(ctx, client, repo, int(number))
		if status == http.StatusOK && item.Kind == "pull" {
			items = append(items, githubPullReference{Number: int(number), Title: item.Title})
		}
		if status == http.StatusNotFound {
			status = http.StatusOK
		}
		return items, status
	}

	query := "repo:" + repo + " is:pr"
	if keyword != "" {
		query += ` in:title "` + keyword + `"`
	}
	params := url.Values{"q": {query}, "per_page": {"6"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/search/issues?"+params.Encode(), nil)
	if err != nil {
		return nil, http.StatusServiceUnavailable
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	res, err := client.Do(req)
	if err != nil {
		return nil, http.StatusServiceUnavailable
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusUnprocessableEntity {
		return items, http.StatusOK
	}
	if res.StatusCode != http.StatusOK {
		return nil, http.StatusServiceUnavailable
	}
	var payload struct {
		Items []struct {
			githubPullReference
			RepositoryURL string           `json:"repository_url"`
			PullRequest   *json.RawMessage `json:"pull_request"`
		} `json:"items"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&payload); err != nil {
		return nil, http.StatusServiceUnavailable
	}
	for _, item := range payload.Items {
		if item.PullRequest != nil && item.Number > 0 && item.Title != "" &&
			strings.EqualFold(item.RepositoryURL, "https://api.github.com/repos/"+repo) {
			items = append(items, item.githubPullReference)
			if len(items) == 6 {
				break
			}
		}
	}
	return items, http.StatusOK
}
