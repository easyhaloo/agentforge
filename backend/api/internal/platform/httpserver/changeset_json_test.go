package httpserver

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The OpenAPI contract declares these five changeset properties as required
// arrays, so null is never a valid value for any of them.
var changesetJSONFields = []string{"revisions", "evaluations", "evidence", "reviews", "audit"}

// newChangesetJSONClient builds the real handler over the in-memory repository,
// registers the team/repo repository, and returns a function that performs one
// authenticated request against organization org-a.
func newChangesetJSONClient(t *testing.T) func(method, path, body string) (int, []byte) {
	t.Helper()
	handler := NewHandlerWithDependencies(DeliveryDependencies{
		Repository: newMemoryRepository(), Catalog: &lifecycleCatalog{},
		Identity: namedIdentity{user: "author-1", role: "owner"},
		CSRF:     allowCSRF{}, AllowedOrigin: "https://app.example.test",
		Git: lifecycleGit{}, Evaluator: lifecycleEvaluator{}, Evidence: lifecycleEvidence{},
		Reviewers: lifecycleReviewers{}, Locker: lifecycleLocker{},
	})
	call := func(method, path, body string) (int, []byte) {
		request := httptest.NewRequest(method, "/api/v1/organizations/org-a"+path, bytes.NewBufferString(body))
		if method != http.MethodGet {
			addValidCSRFCookies(request)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response.Code, response.Body.Bytes()
	}
	if status, body := call(http.MethodPost, "/repositories", `{"slug":"team/repo","default_branch":"main"}`); status != http.StatusCreated {
		t.Fatalf("register repository: %d %s", status, body)
	}
	return call
}

// changesetInResponse returns the changeset object of a single-changeset
// response after checking the status code.
func changesetInResponse(t *testing.T, step string, status, wantStatus int, body []byte) map[string]any {
	t.Helper()
	if status != wantStatus {
		t.Fatalf("%s: status=%d, want %d: %s", step, status, wantStatus, body)
	}
	var envelope struct {
		Changeset map[string]any `json:"changeset"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil || envelope.Changeset == nil {
		t.Fatalf("%s: response has no changeset object (err=%v): %s", step, err, body)
	}
	return envelope.Changeset
}

// requireChangesetJSONArrays fails for every contract-required field that is
// not a real JSON array (null and absent both fail) or that has the wrong
// number of elements. wantLengths follows the order of changesetJSONFields.
func requireChangesetJSONArrays(t *testing.T, step string, changeset map[string]any, wantLengths [5]int) {
	t.Helper()
	for i, field := range changesetJSONFields {
		value, present := changeset[field]
		if !present {
			t.Errorf("%s: %s: key is absent, want a JSON array", step, field)
			continue
		}
		array, ok := value.([]any)
		if !ok {
			t.Errorf("%s: %s: got %T(%v), want a JSON array", step, field, value, value)
			continue
		}
		if len(array) != wantLengths[i] {
			t.Errorf("%s: %s: got %d elements, want %d", step, field, len(array), wantLengths[i])
		}
	}
}

func TestChangesetCreateGetAndListReturnArrays(t *testing.T) {
	call := newChangesetJSONClient(t)

	status, body := call(http.MethodPost, "/changesets", `{"repository":"team/repo","title":"No revisions yet"}`)
	created := changesetInResponse(t, "create", status, http.StatusCreated, body)
	// A new changeset has only its creation event in audit.
	requireChangesetJSONArrays(t, "create", created, [5]int{0, 0, 0, 0, 1})
	id, _ := created["id"].(string)

	status, body = call(http.MethodGet, "/changesets/"+id, "")
	requireChangesetJSONArrays(t, "get", changesetInResponse(t, "get", status, http.StatusOK, body), [5]int{0, 0, 0, 0, 1})

	status, body = call(http.MethodGet, "/changesets", "")
	if status != http.StatusOK {
		t.Fatalf("list: status=%d, want %d: %s", status, http.StatusOK, body)
	}
	var page struct {
		Items []struct {
			Changeset map[string]any `json:"changeset"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &page); err != nil || len(page.Items) != 1 {
		t.Fatalf("list: want exactly one item (err=%v): %s", err, body)
	}
	requireChangesetJSONArrays(t, "list", page.Items[0].Changeset, [5]int{0, 0, 0, 0, 1})
}

func TestChangesetMutationResponsesReturnArrays(t *testing.T) {
	call := newChangesetJSONClient(t)
	status, body := call(http.MethodPost, "/changesets", `{"repository":"team/repo","title":"Mutate me"}`)
	id, _ := changesetInResponse(t, "create", status, http.StatusCreated, body)["id"].(string)
	path := "/changesets/" + id

	// After a revision only the revision exists; evaluations, evidence and reviews are still empty.
	status, body = call(http.MethodPost, path+"/revisions", `{"ref":"feature"}`)
	requireChangesetJSONArrays(t, "add revision", changesetInResponse(t, "add revision", status, http.StatusOK, body), [5]int{1, 0, 0, 0, 2})

	// The fake evaluator passes and returns a report, so evidence is attached; reviews are still empty.
	status, body = call(http.MethodPost, path+"/evaluations", `{}`)
	requireChangesetJSONArrays(t, "evaluate", changesetInResponse(t, "evaluate", status, http.StatusOK, body), [5]int{1, 1, 1, 0, 4})
}
