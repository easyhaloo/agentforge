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
	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/config"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/email"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/postgres"
	"github.com/easyhaloo/agentforge/backend/api/internal/tasks"
)

func main() {
	if handled, status := githttp.RunHelper(os.Args); handled {
		os.Exit(status)
	}
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

	if providerName := os.Getenv("NOTIFICATION_EMAIL_PROVIDER"); providerName != "" {
		provider, err := email.NewProvider(email.Config{
			Provider: providerName, From: os.Getenv("NOTIFICATION_EMAIL_FROM"),
			SendGridAPIKey: os.Getenv("SENDGRID_API_KEY"), SESRegion: os.Getenv("AWS_REGION"),
		})
		if err != nil {
			logger.Error("invalid notification email configuration", "error", err)
			os.Exit(1)
		}
		store.EnableNotificationMail(configuration.AppOrigin)
		go email.DeliverQueued(ctx, email.NewPostgresQueue(store.Pool()), provider, logger)
	}

	go store.RunRepositoryWebhookWorker(ctx, logger)

	providers := make(map[string]identity.OIDCHandler)
	for _, provider := range []struct {
		id     string
		config *config.OIDCConfig
	}{
		{"oidc", configuration.OIDC}, {"google", configuration.Google}, {"github", configuration.GitHub},
	} {
		if provider.config == nil {
			continue
		}
		authConfig := identity.OIDCConfig{
			ProviderID: provider.id, IssuerURL: provider.config.IssuerURL,
			ClientID: provider.config.ClientID, ClientSecret: provider.config.ClientSecret,
			RedirectURL: provider.config.RedirectURL, SessionTTL: configuration.SessionTTL,
			AppOrigin: configuration.AppOrigin,
		}
		var authenticator *identity.OIDCAuthenticator
		var authErr error
		if provider.id == "github" {
			authenticator, authErr = identity.NewGitHubAuthenticator(authConfig, store)
		} else {
			if provider.id == "oidc" {
				authConfig.ProviderID = ""
			}
			authenticator, authErr = identity.NewOIDCAuthenticator(ctx, authConfig, store)
		}
		if authErr != nil {
			logger.Error("SSO provider initialization failed", "provider", provider.id, "error", authErr)
			continue
		}
		providers[provider.id] = authenticator
	}

	issueRepo := postgres.NewIssueRepository(store)
	deps := httpserver.DeliveryDependencies{
		Repository: store, Identity: store, RevokeSession: store.RevokeSession, CSRF: store, Membership: store, Account: store, Settings: store,
		AllowedOrigin: configuration.AppOrigin, SSO: providers, Reviewers: store, Catalog: store, Pipelines: store, Runs: store, WebhookDirectory: os.Getenv("PIPELINE_WEBHOOKS_DIR"), Locker: store, Workspaces: store, Tasks: tasks.NewPostgresStore(store.Pool()),
		IssueRepo:          issueRepo,
		IssueDetailRepo:    issueRepo,
		ProjectRepo:        store,
		CommentRepo:        postgres.NewCommentRepository(store),
		LabelRepo:          postgres.NewLabelRepository(store),
		MilestoneRepo:      postgres.NewMilestoneRepository(store),
		ReactionRepo:       postgres.NewReactionRepository(store),
		EventRepo:          postgres.NewEventRepository(store),
		NotificationRepo:   postgres.NewNotificationRepository(store),
		NotificationEmail:  store,
		RepositoryWebhooks: store,
	}
	if err := configureGit(&deps, configuration, os.Getenv("GIT_REMOTE_BINDINGS_FILE"), logger); err != nil {
		logger.Error("invalid remote integration Git bindings", "error", err)
		os.Exit(1)
	}
	deps.GitCredentials = store
	if os.Getenv("GIT_SMART_HTTP_ENABLED") == "1" {
		provider, ok := deps.Git.(*delivery.LocalGitProvider)
		executable, err := os.Executable()
		if !ok || err != nil {
			logger.Error("Git Smart HTTP requires a local Git repository root and API executable")
			os.Exit(1)
		}
		deps.GitHTTP, err = githttp.New(ctx, provider.Root, executable)
		if err != nil {
			logger.Error("Git Smart HTTP initialization failed", "error", err)
			os.Exit(1)
		}
		go projectGitIssues(ctx, provider, issueRepo, logger)
		go func() {
			ticker := time.NewTicker(10 * time.Second)
			defer ticker.Stop()
			for ctx.Err() == nil {
				if err := deps.GitHTTP.Reconcile(ctx, store.LockGitPolicy); err != nil && ctx.Err() == nil {
					logger.Error("Git push journal recovery failed", "error", err)
				}
				select {
				case <-ctx.Done():
				case <-ticker.C:
				}
			}
		}()
	}

	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := store.AdvanceTriggers(ctx); err != nil && ctx.Err() == nil {
					logger.Error("pipeline trigger reconciliation failed", "error", err)
				}
			}
		}
	}()

	if deps.IntegrationGit != nil {
		go func() {
			ticker := time.NewTicker(time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					if err := store.AdvanceQueue(ctx, deps.IntegrationGit); err != nil && ctx.Err() == nil {
						logger.Error("merge queue reconciliation failed", "error", err)
					}
				}
			}
		}()
	}
	if configuration.EvidenceRoot != "" {
		evidence, evidenceErr := delivery.NewLocalEvidenceStore(configuration.EvidenceRoot)
		if evidenceErr != nil {
			logger.Error("evidence storage initialization failed; evidence and merge operations remain unavailable", "error", evidenceErr)
		} else {
			deps.Evidence = evidence
		}
	}

	// Initialize local password authentication
	localAuthConfig := identity.LocalAuthConfig{
		SessionTTL: 24 * time.Hour,
		AppOrigin:  configuration.AppOrigin,
	}
	localAuth, err := identity.NewLocalAuthenticator(localAuthConfig, store)
	if err != nil {
		logger.Error("local auth initialization failed", "error", err)
		os.Exit(1)
	}
	deps.LocalAuth = localAuth

	server := &http.Server{
		Addr:              ":" + configuration.Port,
		Handler:           httpserver.NewHandlerWithDependencies(deps),
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

func configureGit(deps *httpserver.DeliveryDependencies, configuration config.Config, bindingsFile string, logger *slog.Logger) error {
	if configuration.GitRepositoryRoot != "" {
		provider, providerErr := delivery.NewLocalGitProvider(configuration.GitRepositoryRoot, 2*time.Minute)
		if providerErr != nil {
			logger.Error("Git provider initialization failed; revision and merge operations remain unavailable", "error", providerErr)
		} else {
			deps.Preview = provider
			deps.Git = provider
			deps.IntegrationGit = provider
			deps.Evaluator = delivery.GitDiffEvaluator{Git: provider}
			if configuration.EvaluationDockerImage != "" {
				deps.Evaluator = delivery.DockerEvaluator{Git: provider, Image: configuration.EvaluationDockerImage, Command: configuration.EvaluationCommand, Timeout: 10 * time.Minute}
			}
		}
	}
	if bindingsFile != "" {
		provider, err := delivery.LoadIntegrationGit(bindingsFile, configuration.GitRepositoryRoot, 2*time.Minute)
		if err != nil {
			return err
		}
		deps.IntegrationGit = provider
	}
	return nil
}
