package httpserver

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
)

var hookID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$`)
var githubSHA = regexp.MustCompile(`^[a-f0-9]{40}$`)

type hookBinding struct {
	OrganizationID string `json:"organizationID"`
	PipelineID     string `json:"pipelineID"`
	ActorID        string `json:"actorID"`
	Version        int    `json:"version"`
	RepositoryID   int64  `json:"repositoryID"`
	Branch         string `json:"branch"`
	Event          string `json:"event"`
	Secret         string `json:"secret"`
}

// Only the signed body supplies the event identity, ref and revision. Headers alone cannot select a workflow.
func (b hookBinding) revision(body []byte) string {
	type repo struct {
		ID int64 `json:"id"`
	}
	type revision struct {
		Repo repo   `json:"repo"`
		Ref  string `json:"ref"`
		SHA  string `json:"sha"`
	}
	var e struct {
		Repository repo   `json:"repository"`
		Ref        string `json:"ref"`
		After      string `json:"after"`
		Deleted    bool   `json:"deleted"`
		Action     string `json:"action"`
		PR         *struct {
			Head revision `json:"head"`
			Base revision `json:"base"`
		} `json:"pull_request"`
	}
	if json.Unmarshal(body, &e) != nil || e.Repository.ID != b.RepositoryID {
		return ""
	}
	sha := ""
	switch b.Event {
	case "push":
		if !e.Deleted && e.PR == nil && e.Ref == "refs/heads/"+b.Branch {
			sha = e.After
		}
	case "pull_request":
		if e.PR != nil && (e.Action == "opened" || e.Action == "reopened" || e.Action == "synchronize") && e.PR.Head.Repo.ID == b.RepositoryID && e.PR.Base.Repo.ID == b.RepositoryID && e.PR.Base.Ref == b.Branch {
			sha = e.PR.Head.SHA
		}
	}
	if !githubSHA.MatchString(sha) || sha == strings.Repeat("0", 40) {
		return ""
	}
	return sha
}
func (d DeliveryDependencies) githubPipelineHook(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("hook")
	if !filepath.IsAbs(d.WebhookDirectory) || !hookID.MatchString(id) {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(filepath.Join(d.WebhookDirectory, id+".json"))
	if errors.Is(err, os.ErrNotExist) {
		http.NotFound(w, r)
		return
	}
	var b hookBinding
	if err == nil {
		defer f.Close()
		var cfg []byte
		cfg, err = io.ReadAll(io.LimitReader(f, 16385))
		if err == nil && len(cfg) <= 16384 {
			err = json.Unmarshal(cfg, &b)
		}
	}
	if err != nil || d.Runs == nil || len(b.Secret) < 32 || b.RepositoryID < 1 || b.Branch == "" || b.OrganizationID == "" || b.PipelineID == "" || b.ActorID == "" || b.Version < 1 || (b.Event != "push" && b.Event != "pull_request") {
		writeProblem(w, 503, "Webhook unavailable", "Check the trigger binding")
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		writeProblem(w, 413, "Payload rejected", "Expected at most 1 MiB")
		return
	}
	mac := hmac.New(sha256.New, []byte(b.Secret))
	mac.Write(raw)
	signature, ok := strings.CutPrefix(r.Header.Get("X-Hub-Signature-256"), "sha256=")
	sig, err := hex.DecodeString(signature)
	if !ok || err != nil || !hmac.Equal(sig, mac.Sum(nil)) {
		writeProblem(w, 401, "Invalid signature", "Signature verification failed")
		return
	}
	delivery := r.Header.Get("X-GitHub-Delivery")
	sha := b.revision(raw)
	if r.Header.Get("X-GitHub-Event") != b.Event || !hookID.MatchString(delivery) || sha == "" {
		writeProblem(w, 422, "Event rejected", "The signed event does not match the configured trigger")
		return
	}
	digest := sha256.Sum256(raw)
	_, err = d.Runs.TriggerRun(r.Context(), b.OrganizationID, b.PipelineID, b.Version, b.ActorID, execution.Webhook{Hook: id, Delivery: delivery, Digest: hex.EncodeToString(digest[:]), Event: b.Event, RepositoryID: b.RepositoryID, SHA: sha})
	switch {
	case err == nil:
		w.WriteHeader(http.StatusAccepted)
	case errors.Is(err, execution.ErrTriggerDenied):
		writeProblem(w, 403, "Trigger denied", "The configured actor cannot run this workflow")
	case errors.Is(err, execution.ErrQuota):
		writeProblem(w, 429, "Run quota reached", "Retry later")
	case errors.Is(err, pipeline.ErrConflict), errors.Is(err, pipeline.ErrMissing), errors.Is(err, execution.ErrInputs):
		writeProblem(w, 409, "Trigger conflict", "Check the delivery identity, workflow version and defaults")
	default:
		writeProblem(w, 503, "Webhook unavailable", "Retry later")
	}
}
