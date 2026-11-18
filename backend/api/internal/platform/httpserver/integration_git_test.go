package httpserver

import (
	"context"
	"net/http"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
)

// Only preview is expected here. Repository registration must resolve against the catalog's Git provider.
type integrationPreviewSpy struct {
	delivery.IntegrationGitProvider
}

func (*integrationPreviewSpy) PreviewMerge(ctx context.Context, org, repo string, req delivery.MergeRequest) (delivery.MergePreview, error) {
	return previewGit{}.PreviewMerge(ctx, org, repo, req)
}

type integrationRouteStore struct {
	execution.Store
	execution.QueueStore
	promoter execution.PromotionProvider
	receipts execution.PromotionReceipts
}

func (s *integrationRouteStore) PromoteIntegration(_ context.Context, _, _, _, _ string, git execution.PromotionProvider) error {
	s.promoter = git
	return nil
}
func (s *integrationRouteStore) CancelQueueEntry(_ context.Context, _ string, _ int64, _ string, receipts execution.PromotionReceipts) error {
	s.receipts = receipts
	return nil
}

func TestIntegrationRoutesUseSeparateProvider(t *testing.T) {
	integration := &integrationPreviewSpy{}
	runs := &integrationRouteStore{}
	h := NewHandlerWithDependencies(DeliveryDependencies{
		Repository: newMemoryRepository(), Identity: fixedIdentity{role: "owner"}, CSRF: allowCSRF{}, AllowedOrigin: "https://app.example.test",
		Git: lifecycleGit{}, IntegrationGit: integration, Catalog: &lifecycleCatalog{}, Runs: runs,
	})
	for _, tc := range []struct {
		path, body string
		status     int
	}{
		{"/repositories", `{"slug":"team/repo","default_branch":"main"}`, http.StatusCreated},
		{"/merge-preview", `{"repository":"team/repo","target":"main","sources":["topic"]}`, http.StatusOK},
		{"/pipeline-runs/run/promote", `{"candidateSHA":"reviewed"}`, http.StatusOK},
		{"/merge-queue/1/cancel", "", http.StatusNoContent},
	} {
		response := listFilterRequest(h, http.MethodPost, "/api/v1/organizations/a"+tc.path, tc.body)
		if response.Code != tc.status {
			t.Fatalf("%s: %d %s", tc.path, response.Code, response.Body)
		}
	}
	if runs.promoter != integration || runs.receipts != integration {
		t.Fatal("promotion and cancellation need receipts from the configured integration upstream")
	}
}
