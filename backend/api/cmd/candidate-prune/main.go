// candidate-prune releases one unreachable build ref during quiesced maintenance.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/postgres"
)

func main() {
	apply := flag.Bool("apply-offline", false, "delete the ref after stopping all API, worker and repository writers")
	flag.Parse()
	if flag.NArg() != 3 {
		log.Fatal("usage: candidate-prune [-apply-offline] ORG REPOSITORY FULL_SHA")
	}
	org, repo, sha := flag.Arg(0), flag.Arg(1), flag.Arg(2)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	s, err := postgres.Open(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal("database unavailable")
	}
	defer s.Close()
	keep, err := s.CandidateInUse(ctx, org, repo, sha)
	if err != nil {
		log.Fatal("could not verify candidate ownership")
	}
	if keep {
		fmt.Println("retained by an active build or promotion")
		return
	}
	if !*apply {
		fmt.Println("eligible for offline removal")
		return
	}
	git, err := delivery.LoadIntegrationGit(os.Getenv("GIT_REMOTE_BINDINGS_FILE"), os.Getenv("GIT_REPOSITORY_ROOT"), time.Minute)
	if err != nil {
		log.Fatal(err)
	}
	if err = git.DeleteCandidate(ctx, org, repo, sha); err != nil {
		log.Fatal(err)
	}
	fmt.Println("candidate ref released")
}
