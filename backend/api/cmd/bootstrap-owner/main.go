package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/postgres"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	issuer := strings.TrimSpace(os.Getenv("BOOTSTRAP_OIDC_ISSUER"))
	subject := strings.TrimSpace(os.Getenv("BOOTSTRAP_OIDC_SUBJECT"))
	organizationID := strings.TrimSpace(os.Getenv("BOOTSTRAP_ORGANIZATION_ID"))
	organizationName := strings.TrimSpace(os.Getenv("BOOTSTRAP_ORGANIZATION_NAME"))
	organizationSlug := strings.TrimSpace(os.Getenv("BOOTSTRAP_ORGANIZATION_SLUG"))
	if organizationSlug == "" {
		organizationSlug = identity.Slugify(organizationName)
	}
	if databaseURL == "" || issuer == "" || subject == "" || organizationID == "" || organizationName == "" {
		logger.Error("bootstrap requires DATABASE_URL, BOOTSTRAP_OIDC_ISSUER, BOOTSTRAP_OIDC_SUBJECT, BOOTSTRAP_ORGANIZATION_ID, and BOOTSTRAP_ORGANIZATION_NAME")
		os.Exit(2)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	store, err := postgres.Open(ctx, databaseURL)
	if err != nil {
		logger.Error("database initialization failed", "error", err)
		os.Exit(1)
	}
	defer store.Close()

	userID, err := store.BootstrapFirstOwner(ctx, issuer, subject, organizationID, organizationName, organizationSlug)
	if errors.Is(err, identity.ErrInvalidOrganizationSlug) {
		logger.Error("organization slug is invalid; set BOOTSTRAP_ORGANIZATION_SLUG", "organization_slug", organizationSlug, "error", err)
		os.Exit(2)
	}
	if errors.Is(err, postgres.ErrOrganizationSlugConflict) {
		logger.Error("organization slug conflicts with another organization; set BOOTSTRAP_ORGANIZATION_SLUG to a different value", "organization_slug", organizationSlug, "error", err)
		os.Exit(1)
	}
	if errors.Is(err, postgres.ErrOwnerAlreadyExists) {
		logger.Error("organization already has an owner; bootstrap refused", "organization_id", organizationID)
		os.Exit(1)
	}
	if errors.Is(err, postgres.ErrOrganizationInactive) {
		logger.Error("organization is not active; bootstrap refused", "organization_id", organizationID)
		os.Exit(1)
	}
	if err != nil {
		logger.Error("first-owner bootstrap failed", "error", err)
		os.Exit(1)
	}
	logger.Info("first organization owner provisioned", "organization_id", organizationID, "user_id", userID)
}
