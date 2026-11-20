package delivery

import (
	"context"
	"errors"
	"testing"
)

func TestDockerEvaluatorFailsClosedWithoutPinnedRunnerConfiguration(t *testing.T) {
	_, err := (DockerEvaluator{}).Evaluate(context.Background(), EvaluationJob{ID: "job-1", OrganizationID: "org", Repository: "team/repo", BaseSHA: "base", RevisionSHA: "revision"})
	if !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("missing runner error=%v, want ErrProviderUnavailable", err)
	}
}
