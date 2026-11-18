// The operator runs one bounded expiration batch per invocation.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/easyhaloo/agentforge/backend/api/internal/platform/postgres"
)

func run(ctx context.Context) error {
	s, err := postgres.Open(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		return err
	}
	defer s.Close()
	for n := 0; n < 100; n++ {
		purged, err := s.PurgePipelineObject(ctx)
		if err != nil {
			return err
		}
		if !purged {
			log.Printf("purged %d pipeline payloads", n)
			return nil
		}
	}
	log.Print("purged 100 pipeline payloads; run again to drain backlog")
	return nil
}
func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := run(ctx); err != nil {
		log.Print("pipeline storage cleanup failed: ", err)
		os.Exit(1)
	}
}
