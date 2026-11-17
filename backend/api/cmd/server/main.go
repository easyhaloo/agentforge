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

	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/postgres"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	port := os.Getenv("PORT")
	if port == "" { port = "8080" }

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		logger.Error("DATABASE_URL is required")
		os.Exit(1)
	}
	store, err := postgres.Open(ctx, databaseURL)
	if err != nil {
		logger.Error("database initialization failed", "error", err)
		os.Exit(1)
	}
	defer store.Close()

	server := &http.Server{
		Addr: ":" + port,
		Handler: httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{Repository: store}),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		logger.Info("starting API server", "port", port)
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
