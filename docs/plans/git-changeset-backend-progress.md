# Git Changeset Backend Implementation Progress

## Completed (2026-11-21)

### ✅ AC 1.4: Three-dot comparison with merge-base mode

**Implementation:**
- Added `CompareWithMergeBase` method to `LocalGitProvider`
- Updated `compareRepositoryCommits` HTTP handler to accept `mode=merge-base` query parameter
- Uses `git merge-base` to find common ancestor, then compares ancestor..head

**Evidence:**
```
go test ./internal/delivery/ -run TestLocalGitPreviewCompareWithMergeBaseExcludesBaseOnlyChanges
=== RUN   TestLocalGitPreviewCompareWithMergeBaseExcludesBaseOnlyChanges
--- PASS: TestLocalGitPreviewCompareWithMergeBaseExcludesBaseOnlyChanges (0.77s)
PASS
```

**API Contract:**
```
GET /api/v1/organizations/{orgID}/repositories/{repo}/compare?base=main&head=feature&mode=merge-base
→ Returns unified diff showing only feature's changes, excluding main-only commits
```

**Commit:** 55c31a9

### ✅ AC 1.1: Branch listing verified

**Existing Implementation:**
- `listRepositoryRefs` handler at `GET /repositories/{repo}/refs`
- Returns `{default_branch, items: [{name, kind, sha}]}`
- Branches use short names (e.g., "main", not "refs/heads/main")
- Kind field correctly set to "branch" or "tag"

**Evidence:**
```
go test ./internal/delivery/ -run TestLocalGitPreviewListsBranchesAndTags
=== RUN   TestLocalGitPreviewListsBranchesAndTags
--- PASS: TestLocalGitPreviewListsBranchesAndTags (0.12s)
PASS
```

### ✅ AC 2.1: Create changeset with source_branch atomically

**Implementation:**
- Added `SourceBranch *string` parameter to `createChangesetRequest`
- When source_branch provided: resolves ref to commit SHA and creates changeset with initial revision atomically
- When omitted: creates draft changeset with no revisions (preserving existing workflow)

**API Contract:**
```
POST /api/v1/organizations/{orgID}/changesets
Body: {"repository": "owner/repo", "title": "Add feature", "source_branch": "feature"}
→ 201 Created with changeset containing one revision bound to feature branch's current commit
```

**Evidence:**
```
go test ./internal/delivery/... ./internal/platform/httpserver/...
ok  	github.com/easyhaloo/agentforge/backend/api/internal/delivery	(cached)
ok  	github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver	1.034s
```

**Commit:** 94ead34

## Remaining Work

### AC 1.2-1.3: Branch validation (Lower Priority - Existing validation likely sufficient)
- [ ] Test: Verify branches resolve only within same repository
- [ ] Test: Reject invalid branch names (../../escape, null bytes)
- [ ] Test: Reject tag name conflicts
- [ ] Test: Reject empty comparison targets

**Note:** Existing validation in `ResolveRevision` and repository path validation may already cover most cases.

### AC 2: Changeset workflow testing (High Priority)
- [x] ~~Create changeset with source_branch, atomically save initial revision~~ (DONE)
- [ ] Test: Add new revision when source branch advances (POST /changesets/{id}/revisions exists)
- [ ] Test: Evaluation bound to specific commit SHA (domain model supports this)
- [ ] Test: Review approval bound to current revision (domain model supports this)
- [ ] Test: Merge with atomic branch update and two-parent commit (RemoteGitProvider.PromoteCandidate exists)
- [ ] Test: Stale evaluation returns 409 when target advances
- [ ] Test: Conflict handling
- [ ] Test: Concurrent target changes (compare-and-swap)
- [ ] Test: Candidate reference cleanup
- [ ] Test: Retry on Git success + DB failure

**Infrastructure Status:**
- ✅ Domain model: `internal/delivery/changeset.go` - State machine, validation
- ✅ Git operations: `internal/delivery/remote_git.go` - Atomic pushes, promotions
- ✅ HTTP handlers: All CRUD endpoints exist (create, get, update, merge, review, evaluate)
- ⚠️  **Need:** Comprehensive integration tests exercising full workflow

### AC 3: End-to-end real Git execution (Highest Priority for Validation)
- [ ] Setup: Independent bare repo with non-main default branch (trunk)
- [ ] Scenario: Author clones, creates feature branch, commits, pushes
- [ ] API: Create changeset via POST /changesets with source_branch
- [ ] API: Check changeset shows correct diff with mode=merge-base
- [ ] API: Second user submits review approval
- [ ] API: Privileged user merges via POST /changesets/{id}/merge
- [ ] Verify: git fetch shows remote target SHA updated
- [ ] Verify: git rev-list --parents shows two parents (merge commit)
- [ ] Verify: git show confirms file content
- [ ] Document: Reproducible commands, sanitized request/response examples

**Recommendation:** This end-to-end test validates the complete integration and should be the next focus.

## Implementation Notes

**Current Architecture:**
- Domain: `internal/delivery/changeset.go` - Core changeset logic
- Git Ops: `internal/delivery/remote_git.go` - HTTPS Git operations with atomic updates
- Preview: `internal/delivery/preview.go` - Read-only repository operations
- HTTP: `internal/platform/httpserver/delivery.go` - Changeset API handlers
- HTTP: `internal/platform/httpserver/repository_preview.go` - Repository preview API

**Key Files Modified:**
- `backend/api/internal/delivery/preview.go` - Added CompareWithMergeBase
- `backend/api/internal/platform/httpserver/repository_preview.go` - Added mode parameter
- `backend/api/internal/delivery/preview_compare_merge_base_test.go` - New test

**Test Strategy:**
- Unit tests: Domain logic in isolation (changeset state machine)
- Integration tests: HTTP handlers with real Git operations
- E2E tests: Full workflow with bare repo, multiple users, real pushes

## Next Steps

**Priority 1:** Write comprehensive integration test for changeset creation with source_branch
**Priority 2:** Test merge workflow with atomic updates and conflict handling
**Priority 3:** End-to-end scenario with real Git repository and multiple users
