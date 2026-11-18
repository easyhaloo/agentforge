package main

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/config"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func TestConfigureGit(t *testing.T) {
	root := t.TempDir()
	bindings := filepath.Join(t.TempDir(), "bindings.json")
	if err := os.WriteFile(bindings, []byte(`[{"provider":"github","organizationId":"org","repository":"team/repo","url":"https://git.example/team/repo.git"}]`), 0600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ name, file, image string }{
		{"local", "", ""}, {"remote with local diff", bindings, ""}, {"remote with local Docker", bindings, "fixture"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var deps httpserver.DeliveryDependencies
			if err := configureGit(&deps, config.Config{GitRepositoryRoot: root, EvaluationDockerImage: tc.image}, tc.file, slog.Default()); err != nil {
				t.Fatal(err)
			}
			local, ok := deps.Git.(*delivery.LocalGitProvider)
			if !ok {
				t.Fatalf("catalog Git: %T", deps.Git)
			}
			if tc.file == "" {
				if deps.IntegrationGit != local {
					t.Fatal("expected local integration provider")
				}
			} else if _, ok := deps.IntegrationGit.(*delivery.RemoteGitProvider); !ok {
				t.Fatalf("integration Git: %T", deps.IntegrationGit)
			}
			if tc.image == "" {
				if eval, ok := deps.Evaluator.(delivery.GitDiffEvaluator); !ok || eval.Git != local {
					t.Fatalf("diff evaluator: %T", deps.Evaluator)
				}
			} else if eval, ok := deps.Evaluator.(delivery.DockerEvaluator); !ok || eval.Image != tc.image || eval.Git != local {
				t.Fatalf("container evaluator: %T", deps.Evaluator)
			}
		})
	}
	if err := configureGit(&httpserver.DeliveryDependencies{}, config.Config{GitRepositoryRoot: root}, bindings+".missing", slog.Default()); err == nil {
		t.Fatal("startup accepted missing configured bindings")
	}
}
