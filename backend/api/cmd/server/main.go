package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/config"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/postgres"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	configuration, err := config.LoadFromEnv()
	if err != nil {
		logger.Error("invalid API configuration", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	store, err := postgres.Open(ctx, configuration.DatabaseURL)
	if err != nil {
		logger.Error("database initialization failed", "error", err)
		os.Exit(1)
	}
	defer store.Close()

	var oidcHandler identity.OIDCHandler
	var principalResolver identity.PrincipalResolver
	if configuration.OIDC != nil {
		authenticator, authErr := identity.NewOIDCAuthenticator(ctx, identity.OIDCConfig{
			IssuerURL: configuration.OIDC.IssuerURL,
			ClientID: configuration.OIDC.ClientID,
			ClientSecret: configuration.OIDC.ClientSecret,
			RedirectURL: configuration.OIDC.RedirectURL,
			SessionTTL: configuration.SessionTTL,
			AppOrigin: configuration.AppOrigin,
		}, store)
		if authErr != nil {
			logger.Error("OIDC provider initialization failed; protected routes remain unavailable", "error", authErr)
		} else {
			oidcHandler = authenticator
			principalResolver = store
		}
	}


	var gitProvider delivery.GitProvider
	var previewReader delivery.RepositoryPreviewReader
	var evaluator delivery.Evaluator
	var evidenceStore delivery.EvidenceStore
	if configuration.GitRepositoryRoot != "" {
		provider, providerErr := delivery.NewLocalGitProvider(configuration.GitRepositoryRoot, 2*time.Minute)
		if providerErr != nil { logger.Error("Git provider initialization failed; revision and merge operations remain unavailable", "error", providerErr) } else {
			gitProvider = provider
			previewReader = provider
			evaluator = delivery.GitDiffEvaluator{Git: provider}
			if configuration.EvaluationDockerImage != "" { evaluator = delivery.DockerEvaluator{Git: provider, Image: configuration.EvaluationDockerImage, Command: configuration.EvaluationCommand, Timeout: 10*time.Minute} }
		}
	}
	if configuration.EvidenceRoot != "" {
		evidence, evidenceErr := delivery.NewLocalEvidenceStore(configuration.EvidenceRoot)
		if evidenceErr != nil { logger.Error("evidence storage initialization failed; evidence and merge operations remain unavailable", "error", evidenceErr) } else { evidenceStore = evidence }
	}

	server := &http.Server{
		Addr:              ":" + configuration.Port,
		Handler:           httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
			Repository: store, Identity: principalResolver, CSRF: store, Membership: store, Account: store,
			AllowedOrigin: configuration.AppOrigin, OIDC: oidcHandler, Git: gitProvider, Evaluator: evaluator, Evidence: evidenceStore, Reviewers: store, Catalog: store, Preview: previewReader, Locker: store, Workspaces: store,
		}),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		logger.Info("starting API server", "port", configuration.Port)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("API server failed", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("API server shutdown failed", "error", err)
		os.Exit(1)
	}
	logger.Info("API server stopped")
}
