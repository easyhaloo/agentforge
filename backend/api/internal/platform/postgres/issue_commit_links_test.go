package postgres

import (
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
)

func TestCommitIssueProjection(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("requires PostgreSQL")
	}
	ctx := t.Context()
	store, err := Open(ctx, slugScratchDatabase(t, dsn, 1))
	lockMust(t, err)
	t.Cleanup(store.Close)
	fixture := &lockFixture{ctx: ctx, store: store}
	const repo, otherRepo = "team/one", "team/two"
	owner := newLockHTTP(t, fixture, 0, repo, otherRepo)
	outsider := newLockHTTP(t, fixture, 0, repo)
	issueRepo := NewIssueRepository(store)
	create := func(user *lockHTTP, slug, id string) *issues.Issue {
		t.Helper()
		now := time.Now().UTC().Truncate(time.Microsecond)
		row, err := issueRepo.Create(ctx, user.organizationID, &issues.Issue{
			ID: issues.ID(id), Repository: slug, Title: id, CreatedBy: user.userID,
			State: issues.StateOpen, CreatedAt: now, UpdatedAt: now,
		})
		lockMust(t, err)
		return row
	}
	issue := create(owner, repo, "mentioned")
	other := create(owner, otherRepo, "other-repo")
	outside := create(outsider, repo, "other-org")
	if issue.Number != 1 || other.Number != 1 || outside.Number != 1 {
		t.Fatal("fixtures must share issue number #1")
	}
	sha := strings.Repeat("a", 40)
	for range 2 {
		lockMust(t, issueRepo.LinkCommitIssues(ctx, owner.organizationID, repo, sha, "Work on #1", "Work on #1 and #999"))
	}
	assertCommits := func(user *lockHTTP, row *issues.Issue, want []issues.CommitLink) {
		t.Helper()
		got, err := issueRepo.Get(ctx, user.organizationID, row.Repository, row.Number)
		lockMust(t, err)
		if !slices.Equal(got.Commits, want) {
			t.Fatalf("issue %s links = %+v, want %+v", row.ID, got.Commits, want)
		}
	}
	assertNumbers := func(user *lockHTTP, slug string, want []int) {
		t.Helper()
		got, err := issueRepo.IssuesForCommit(ctx, user.organizationID, slug, sha)
		lockMust(t, err)
		if !slices.Equal(got, want) {
			t.Fatalf("commit issues = %v, want %v", got, want)
		}
	}
	assertCommits(owner, issue, []issues.CommitLink{{SHA: sha, Subject: "Work on #1"}})
	assertCommits(owner, other, nil)
	assertCommits(outsider, outside, nil)
	assertNumbers(owner, repo, []int{1})
	assertNumbers(owner, otherRepo, nil)
	assertNumbers(outsider, repo, nil)
	moved, err := issueRepo.Transfer(ctx, issues.DetailScope{
		OrganizationID: owner.organizationID, Repository: repo, Number: issue.Number, UserID: owner.userID, CanManage: true,
	}, otherRepo, issue.UpdatedAt)
	lockMust(t, err)
	assertCommits(owner, moved, nil)
	assertNumbers(owner, repo, nil)
}
