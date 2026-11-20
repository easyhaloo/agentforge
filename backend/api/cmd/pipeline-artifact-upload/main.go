// Publish a binary artifact from a trusted runner host using its attempt receipt.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/postgres"
)

func upload(ctx context.Context, args []string, input io.Reader) error {
	if len(args) != 4 {
		return errors.New("usage: pipeline-artifact-upload RUN STEP ATTEMPT SHA256 < artifact")
	}
	attempt, err := strconv.Atoi(args[2])
	if err != nil || attempt < 1 {
		return errors.New("attempt must be a positive integer")
	}
	receipt := os.Getenv("PIPELINE_ATTEMPT_RECEIPT")
	if receipt == "" {
		return errors.New("missing PIPELINE_ATTEMPT_RECEIPT")
	}
	store, err := postgres.Open(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		return errors.New("could not initialize artifact storage")
	}
	defer store.Close()
	return store.PublishTaskArtifact(ctx, execution.Task{RunID: args[0], StepID: args[1], WorkerID: receipt, Attempt: attempt}, args[3], input)
}
func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := upload(ctx, os.Args[1:], os.Stdin); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
