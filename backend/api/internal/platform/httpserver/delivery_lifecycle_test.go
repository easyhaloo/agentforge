package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

type namedIdentity struct{ user, role string }

func (i namedIdentity) ResolvePrincipal(_ *http.Request, org string) (Principal, error) {
	return Principal{UserID: i.user, OrganizationID: org, Role: i.role}, nil
}

type lifecycleGit struct{}

func (lifecycleGit) ResolveRevision(_ context.Context, _, _, ref string) (delivery.GitRevision, error) {
	return delivery.GitRevision{Ref: ref, CommitSHA: "commit-" + ref, ParentSHA: "commit-base"}, nil
}
func (lifecycleGit) MergeRevision(_ context.Context, _, _, _, target, _ string) (delivery.GitMerge, error) {
	return delivery.GitMerge{CommitSHA: "merge-commit", TargetRef: target}, nil
}

type lifecycleEvaluator struct{}

func (lifecycleEvaluator) Evaluate(_ context.Context, job delivery.EvaluationJob) (delivery.EvaluationResult, error) {
	return delivery.EvaluationResult{JobID: job.ID, OrganizationID: job.OrganizationID, ChangesetID: job.ChangesetID, RevisionID: job.RevisionID, BaseSHA: job.BaseSHA, RevisionSHA: job.RevisionSHA, Passed: true, Summary: "checks passed", Report: []byte(`{"checks":[{"name":"unit","passed":true}]}`)}, nil
}

type lifecycleEvidence struct{}

func (lifecycleEvidence) Put(context.Context, string, string, []byte) (delivery.EvidenceArtifact, error) {
	return delivery.EvidenceArtifact{URI: "file:///evidence/report.json", SHA256: "sha256-test", Size: 42}, nil
}

type lifecycleReviewers struct{}

func (lifecycleReviewers) IsActiveMember(_ context.Context, _, user string) (bool, error) {
	return user == "reviewer-1", nil
}

type lifecycleLocker struct{}

func (lifecycleLocker) LockChangeset(context.Context, string, string) (func(), error) {
	return func() {}, nil
}

type lifecycleCatalog struct{ items []delivery.RepositoryMetadata }

func (c *lifecycleCatalog) RegisterRepository(_ context.Context, item delivery.RepositoryMetadata) (delivery.RepositoryMetadata, error) {
	c.items = append(c.items, item)
	return item, nil
}
func (c *lifecycleCatalog) ListRepositories(_ context.Context, org string) ([]delivery.RepositoryMetadata, error) {
	items := []delivery.RepositoryMetadata{}
	for _, item := range c.items {
		if item.OrganizationID == org {
			items = append(items, item)
		}
	}
	return items, nil
}

func TestCompleteChangesetLifecycleThroughHTTP(t *testing.T) {
	repository := newMemoryRepository()
	catalog := &lifecycleCatalog{}
	deps := DeliveryDependencies{Repository: repository, Catalog: catalog, Identity: namedIdentity{user: "author-1", role: "owner"}, CSRF: allowCSRF{}, AllowedOrigin: "https://app.example.test", Git: lifecycleGit{}, Evaluator: lifecycleEvaluator{}, Evidence: lifecycleEvidence{}, Reviewers: lifecycleReviewers{}, Locker: lifecycleLocker{}}
	handler := NewHandlerWithDependencies(deps)
	call := func(method, path, body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		if method != "GET" {
			addValidCSRFCookies(request)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}
	base := "/api/v1/organizations/org-a"
	response := call(http.MethodPost, base+"/repositories", `{"slug":"team/repo","default_branch":"main"}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("register repository: %d %s", response.Code, response.Body.String())
	}
	response = call(http.MethodPost, base+"/changesets", `{"repository":"team/repo","title":"Deliver feature"}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("create changeset: %d %s", response.Code, response.Body.String())
	}
	var stored storedChangesetResponse
	if err := json.Unmarshal(response.Body.Bytes(), &stored); err != nil {
		t.Fatal(err)
	}
	changePath := base + "/changesets/" + string(stored.Changeset.ID)
	response = call(http.MethodPost, changePath+"/revisions", `{"ref":"feature"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("add revision: %d %s", response.Code, response.Body.String())
	}
	response = call(http.MethodPost, changePath+"/evaluations", `{}`)
	if response.Code != http.StatusOK {
		t.Fatalf("evaluate: %d %s", response.Code, response.Body.String())
	}
	response = call(http.MethodPost, changePath+"/reviews", `{"reviewer_id":"reviewer-1","comment":"Please verify"}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("assign review: %d %s", response.Code, response.Body.String())
	}
	if err := json.Unmarshal(response.Body.Bytes(), &stored); err != nil {
		t.Fatal(err)
	}
	if len(stored.Changeset.Reviews) != 1 {
		t.Fatalf("reviews=%d", len(stored.Changeset.Reviews))
	}
	reviewID := string(stored.Changeset.Reviews[0].ID)
	wrongReviewerRequest := httptest.NewRequest(http.MethodPost, changePath+"/reviews/"+reviewID+"/decision", bytes.NewBufferString(`{"approved":true}`))
	addValidCSRFCookies(wrongReviewerRequest)
	wrongReviewerResponse := httptest.NewRecorder()
	handler.ServeHTTP(wrongReviewerResponse, wrongReviewerRequest)
	if wrongReviewerResponse.Code != http.StatusForbidden {
		t.Fatalf("unassigned reviewer decision status=%d, want 403", wrongReviewerResponse.Code)
	}
	blockedMerge := call(http.MethodPost, changePath+"/merge", `{"target_ref":"main"}`)
	if blockedMerge.Code != http.StatusConflict {
		t.Fatalf("merge without approval status=%d, want 409", blockedMerge.Code)
	}
	reviewerHandler := NewHandlerWithDependencies(DeliveryDependencies{Repository: repository, Identity: namedIdentity{user: "reviewer-1", role: "member"}, CSRF: allowCSRF{}, AllowedOrigin: "https://app.example.test", Git: lifecycleGit{}, Evaluator: lifecycleEvaluator{}, Evidence: lifecycleEvidence{}, Reviewers: lifecycleReviewers{}, Catalog: catalog})
	request := httptest.NewRequest(http.MethodPost, changePath+"/reviews/"+reviewID+"/decision", bytes.NewBufferString(`{"approved":true,"comment":"Approved"}`))
	addValidCSRFCookies(request)
	response = httptest.NewRecorder()
	reviewerHandler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("decide review: %d %s", response.Code, response.Body.String())
	}
	handler = NewHandlerWithDependencies(deps)
	response = call(http.MethodPost, changePath+"/merge", `{"target_ref":"main"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("merge: %d %s", response.Code, response.Body.String())
	}
	if err := json.Unmarshal(response.Body.Bytes(), &stored); err != nil {
		t.Fatal(err)
	}
	if stored.Changeset.Merge == nil || stored.Changeset.Merge.CommitSHA != "merge-commit" {
		t.Fatalf("merge result not persisted: %#v", stored.Changeset.Merge)
	}
	if len(stored.Changeset.Evaluations) != 1 || stored.Changeset.Evaluations[0].Status != delivery.EvaluationPassed {
		t.Fatal("passing evaluation was not persisted")
	}
	if len(stored.Changeset.Evidence) != 1 || stored.Changeset.Evidence[0].SHA256 != "sha256-test" {
		t.Fatal("content-addressed evidence was not persisted")
	}
	if stored.Changeset.Reviews[0].Status != delivery.ReviewApproved {
		t.Fatal("review approval was not persisted")
	}
	if stored.Changeset.Revisions[0].CommitSHA != "commit-feature" {
		t.Fatal("immutable Git commit SHA was not persisted")
	}
	if stored.UpdatedAt.Before(time.Now().Add(-time.Minute)) {
		t.Fatal("changeset update timestamp was not advanced")
	}
}

type mismatchedLifecycleEvaluator struct{}

func (mismatchedLifecycleEvaluator) Evaluate(_ context.Context, job delivery.EvaluationJob) (delivery.EvaluationResult, error) {
	return delivery.EvaluationResult{
		JobID: job.ID, OrganizationID: job.OrganizationID, ChangesetID: job.ChangesetID,
		RevisionID: job.RevisionID, BaseSHA: job.BaseSHA, RevisionSHA: "different-commit",
		Passed: true, Summary: "untrusted result",
	}, nil
}

func TestEvaluationRejectsResultForDifferentRevision(t *testing.T) {
	repository := newMemoryRepository()
	catalog := &lifecycleCatalog{}
	deps := DeliveryDependencies{
		Repository: repository, Catalog: catalog,
		Identity: namedIdentity{user: "author-1", role: "owner"},
		CSRF:     allowCSRF{}, AllowedOrigin: "https://app.example.test",
		Git: lifecycleGit{}, Evaluator: mismatchedLifecycleEvaluator{},
		Evidence: lifecycleEvidence{}, Reviewers: lifecycleReviewers{}, Locker: lifecycleLocker{},
	}
	handler := NewHandlerWithDependencies(deps)
	call := func(method, path, body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		if method != http.MethodGet {
			addValidCSRFCookies(request)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}
	base := "/api/v1/organizations/org-a"
	if response := call(http.MethodPost, base+"/repositories", `{"slug":"team/repo","default_branch":"main"}`); response.Code != http.StatusCreated {
		t.Fatalf("register repository: %d %s", response.Code, response.Body.String())
	}
	response := call(http.MethodPost, base+"/changesets", `{"repository":"team/repo","title":"Reject mismatched worker result"}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("create changeset: %d %s", response.Code, response.Body.String())
	}
	var stored storedChangesetResponse
	if err := json.Unmarshal(response.Body.Bytes(), &stored); err != nil {
		t.Fatal(err)
	}
	changePath := base + "/changesets/" + string(stored.Changeset.ID)
	if response = call(http.MethodPost, changePath+"/revisions", `{"ref":"feature"}`); response.Code != http.StatusOK {
		t.Fatalf("add revision: %d %s", response.Code, response.Body.String())
	}
	if response = call(http.MethodPost, changePath+"/evaluations", `{}`); response.Code != http.StatusBadGateway {
		t.Fatalf("mismatched evaluation result status=%d body=%s, want 502", response.Code, response.Body.String())
	}
	response = call(http.MethodGet, changePath, "")
	if response.Code != http.StatusOK {
		t.Fatalf("load changeset: %d %s", response.Code, response.Body.String())
	}
	if err := json.Unmarshal(response.Body.Bytes(), &stored); err != nil {
		t.Fatal(err)
	}
	if len(stored.Changeset.Evaluations) != 0 {
		t.Fatalf("untrusted evaluation was persisted: %#v", stored.Changeset.Evaluations)
	}
}
