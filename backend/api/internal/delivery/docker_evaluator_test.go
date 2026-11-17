package delivery

import (
	"context"
	"errors"
	"testing"
)

func TestDockerEvaluatorFailsClosedWithoutPinnedRunnerConfiguration(t *testing.T) {
	_,err:=(DockerEvaluator{}).Evaluate(context.Background(),"org","team/repo","base","revision")
	if !errors.Is(err,ErrProviderUnavailable){t.Fatalf("missing runner error=%v, want ErrProviderUnavailable",err)}
}
