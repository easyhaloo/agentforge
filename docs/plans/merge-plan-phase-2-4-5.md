# AgentForge Parallel Development Branches - Merge Plan

## Executive Summary

Three parallel development branches are ready for merge, containing Phase 2, 4, and 5 implementations. Total impact: ~4,900 lines added across 52 files.

**Critical Issues Identified**:
1. 🔴 **Migration number conflict**: Both Phase 2 and Phase 5 have migration 020
2. 🔴 **Binary file committed**: Phase 5 includes `backend/api/server` (22.5MB) - must be removed
3. 🟡 **go.mod/go.sum conflicts**: Both Phase 2 and Phase 5 modified these files

**Status**: Ready for merge after resolving critical issues.

---

## Branches Overview

### 1. Phase 2 Backend Hardening
**Branch**: `worktree-agent-a001da428ff30df28`  
**Commit**: `03dda19`  
**Changes**: 15 files, +1,969/-13 lines

**Deliverables**:
- ✅ Centralized authorization policy (`internal/platform/authz/`)
- ✅ Email provider integration (SendGrid + AWS SES)
- ✅ PostgreSQL email queue with retry logic
- ✅ Cross-tenant authorization tests
- ✅ Session security tests
- ✅ Production OIDC configuration documentation
- ✅ Migration 020: `020_email_queue.sql`

**Key Files**:
- `backend/api/internal/platform/authz/policy.go` (130 lines)
- `backend/api/internal/platform/email/*.go` (571 lines)
- `backend/api/migrations/020_email_queue.sql`
- `deployments/production/OIDC-CONFIGURATION.md` (250 lines)
- Updated `go.mod` (AWS SES SDK dependency)

**Test Status**: ✅ All tests pass

---

### 2. Phase 5 Execution Subsystem
**Branch**: `worktree-agent-a9b46f6c84f9cb672`  
**Commit**: `c200b73`  
**Changes**: 14 files, +2,293 lines

**Deliverables**:
- ✅ Task store with PostgreSQL-based queue
- ✅ Worker binary (`cmd/task-worker/`)
- ✅ Task claiming, leases, heartbeat, recovery
- ✅ Isolated execution with timeout/cancellation
- ✅ HTTP API for executions
- ✅ Migration 020: `020_execution_subsystem.sql` ⚠️ **CONFLICT**
- ✅ Integration tests (255 lines)
- ✅ Implementation report (404 lines)

**Key Files**:
- `backend/api/cmd/task-worker/main.go` (405 lines)
- `backend/api/internal/tasks/*.go` (1,120 lines)
- `backend/api/migrations/020_execution_subsystem.sql` ⚠️
- `backend/api/server` (22.5MB binary) 🔴 **MUST REMOVE**

**Test Status**: ✅ All tests pass (but binary file issue)

**Critical Issues**:
1. Migration numbered 020, conflicts with Phase 2's 020
2. Binary file `backend/api/server` should not be committed

---

### 3. Phase 4 Frontend Migration
**Branch**: `worktree-agent-a71b6ea5c8ea54a7f`  
**Commit**: `afb3347`  
**Changes**: 23 files, +674/-25 lines

**Deliverables**:
- ✅ TrailsPage (audit trail) - 213 lines
- ✅ ReviewPage (assigned reviews) - 136 lines
- ✅ EvalPage (evaluations) - 143 lines
- ✅ All pages connected to real APIs (no LocalStorage)
- ✅ Organization-scoped routes (`/orgs/:org/*`)
- ✅ Comprehensive locale files (en-US, zh-CN)
- ✅ Updated ADR-008
- ✅ Removed legacy Stacks page

**Key Files**:
- `apps/web/src/pages/{eval,review,trails}/*.tsx` (492 lines)
- `apps/web/src/locales/**/*.json` (144 lines)
- Route configuration updates
- Navigation updates

**Test Status**: ✅ All 354 tests pass

**Dependencies**: None - pure frontend work

---

## Critical Issues Resolution

### Issue 1: Migration Number Conflict 🔴

**Problem**: Both Phase 2 and Phase 5 have migration 020.

**Solution**: Renumber Phase 5's migration to 021.

**Action Plan**:
1. In Phase 5 branch, rename `020_execution_subsystem.sql` → `021_execution_subsystem.sql`
2. Update any code references to migration 020 → 021
3. Amend the commit

**Implementation**:
```bash
# Switch to Phase 5 worktree
cd /Users/shenggangshu/llm/agentforge/.claude/worktrees/agent-a9b46f6c84f9cb672

# Rename migration file
git mv backend/api/migrations/020_execution_subsystem.sql \
        backend/api/migrations/021_execution_subsystem.sql

# Check for hardcoded references (unlikely, but verify)
grep -r "020_execution" backend/api/

# Amend the commit
git add -A
git commit --amend --no-edit
```

---

### Issue 2: Binary File Committed 🔴

**Problem**: `backend/api/server` (22.5MB) binary is tracked in Phase 5.

**Solution**: Remove from git history and add to .gitignore.

**Action Plan**:
1. Remove binary from git
2. Ensure .gitignore excludes binaries
3. Amend the commit

**Implementation**:
```bash
# Switch to Phase 5 worktree
cd /Users/shenggangshu/llm/agentforge/.claude/worktrees/agent-a9b46f6c84f9cb672

# Remove binary file from git
git rm --cached backend/api/server

# Verify .gitignore includes binaries
echo "backend/api/server" >> backend/api/.gitignore
echo "backend/api/task-worker" >> backend/api/.gitignore

# Amend the commit
git add -A
git commit --amend --no-edit
```

---

### Issue 3: go.mod/go.sum Conflicts 🟡

**Problem**: Both Phase 2 and Phase 5 modified go.mod/go.sum.

**Solution**: Accept both changes, run `go mod tidy` after merging Phase 2.

**Action Plan**:
1. Merge Phase 2 first
2. After merging Phase 2, before merging Phase 5:
   ```bash
   cd backend/api
   go mod tidy
   go mod verify
   git add go.mod go.sum
   git commit -m "chore: tidy go modules after Phase 2 merge"
   ```
3. Then merge Phase 5 (should auto-resolve or have minimal conflict)

---

## Recommended Merge Order

### Order: Phase 2 → Phase 5 (fixed) → Phase 4

**Rationale**:
1. **Phase 2 first**: Establishes migration 020 (email_queue), no dependencies
2. **Phase 5 second**: After fixing migration number to 021 and removing binary
3. **Phase 4 last**: Pure frontend, zero backend conflicts

---

## Merge Execution Plan

### Pre-Merge Checklist

- [ ] Fix Phase 5 migration number conflict (020 → 021)
- [ ] Remove binary file from Phase 5
- [ ] Verify all tests pass on each branch independently
- [ ] Backup current main branch
- [ ] Ensure local main is up-to-date with origin/main

### Step 1: Fix Phase 5 Issues

```bash
# Switch to Phase 5 worktree
cd /Users/shenggangshu/llm/agentforge/.claude/worktrees/agent-a9b46f6c84f9cb672

# Rename migration
git mv backend/api/migrations/020_execution_subsystem.sql \
        backend/api/migrations/021_execution_subsystem.sql

# Remove binary
git rm --cached backend/api/server
echo "backend/api/server" >> backend/api/.gitignore
echo "backend/api/task-worker" >> backend/api/.gitignore

# Stage and amend
git add -A
git commit --amend --no-edit

# Verify
git log --oneline -1
git show --stat
```

### Step 2: Merge Phase 2

```bash
# Switch to main worktree
cd /Users/shenggangshu/llm/agentforge

# Ensure main is clean and up-to-date
git checkout main
git pull origin main

# Merge Phase 2
git merge --no-ff worktree-agent-a001da428ff30df28 -m "Merge Phase 2: backend platform hardening

- Centralized authorization policy
- Email provider integration (SendGrid/SES)
- Cross-tenant authorization tests
- Session security tests
- Production OIDC documentation
- Migration 020: email_queue

Merged from worktree-agent-a001da428ff30df28 (03dda19)"

# Run tests
npm test
cd backend/api && go test ./...

# If tests pass, continue. If not, fix and commit.
```

### Step 3: Tidy Go Modules

```bash
cd backend/api
go mod tidy
go mod verify
cd ../..

# Commit if changes
git add backend/api/go.mod backend/api/go.sum
git commit -m "chore: tidy go modules after Phase 2 merge"
```

### Step 4: Merge Phase 5

```bash
# Merge Phase 5 (with fixed migration number)
git merge --no-ff worktree-agent-a9b46f6c84f9cb672 -m "Merge Phase 5: execution subsystem

- Task store with PostgreSQL queue
- Worker binary (cmd/task-worker)
- Lease-based task coordination
- Isolated execution with timeout/cancellation
- Execution HTTP API
- Migration 021: execution_subsystem
- Integration tests

Merged from worktree-agent-a9b46f6c84f9cb672 (c200b73, updated)"

# Resolve any go.mod conflicts if they occur
# Accept both changes and run go mod tidy again if needed

# Run tests
npm test
cd backend/api && go test ./...
go build ./cmd/server
go build ./cmd/task-worker

# If binaries build and tests pass, continue
```

### Step 5: Merge Phase 4

```bash
# Merge Phase 4 (frontend)
git merge --no-ff worktree-agent-a71b6ea5c8ea54a7f -m "Merge Phase 4: frontend API migration

- Migrate Trails/Review/Eval workspaces to real APIs
- Remove LocalStorage usage
- Organization-scoped routes
- Comprehensive locales (en-US, zh-CN)
- Remove legacy Stacks page
- Update ADR-008

Merged from worktree-agent-a71b6ea5c8ea54a7f (afb3347)"

# Run tests
npm test

# If tests pass, merge is complete
```

### Step 6: Post-Merge Verification

```bash
# Run full test suite
npm test
cd backend/api && go test ./...

# Verify builds
npm run build
cd backend/api
go build ./cmd/server
go build ./cmd/task-worker

# Check migrations
ls -la backend/api/migrations/

# Should see:
# 020_email_queue.sql (from Phase 2)
# 021_execution_subsystem.sql (from Phase 5, renumbered)

# Push to origin
git push origin main
```

---

## Rollback Plan

If any merge causes issues:

### Rollback Single Merge
```bash
# If the last merge failed
git merge --abort

# OR if already committed but problematic
git reset --hard HEAD~1  # Careful: loses the merge commit
```

### Rollback All Merges
```bash
# Reset to state before any merges
git reset --hard <commit-hash-before-merges>

# Force push if already pushed (DANGEROUS, coordinate with team)
# git push origin main --force
```

### Safe Rollback
```bash
# Create a revert commit instead (preserves history)
git revert -m 1 <merge-commit-hash>
```

---

## Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Migration conflict | HIGH | 100% | Fixed before merge (renumber to 021) |
| Binary bloat | HIGH | 100% | Remove before merge |
| go.mod conflict | MEDIUM | 80% | Merge Phase 2 first, tidy modules |
| Test failures | MEDIUM | 20% | All tests pass individually |
| Breaking changes | LOW | 10% | Changes are additive, not breaking |
| Deployment issues | MEDIUM | 30% | New migrations, new worker binary |

---

## Post-Merge Tasks

### Immediate (Same Day)
- [ ] Run migrations in development environment
- [ ] Test email provider integration
- [ ] Test execution subsystem with task-worker
- [ ] Test frontend workspaces (Trails/Review/Eval)
- [ ] Update deployment documentation

### Short-term (This Week)
- [ ] Update roadmap document to reflect completed phases
- [ ] Deploy to staging environment
- [ ] End-to-end integration testing
- [ ] Update API documentation
- [ ] Clean up worktree branches after successful merge

### Follow-up Work
- [ ] Add E2E tests for new frontend pages
- [ ] Monitor email queue performance
- [ ] Monitor task execution worker
- [ ] Production deployment planning

---

## Dependencies on Other Work

### Phase 3 Changeset Lifecycle
**Status**: Mentioned as "implemented, pending CI and review"  
**Impact**: Should be merged before or with these branches  
**Action**: Locate this branch and include in merge plan

### Codex Pipeline UI Work
**Status**: In progress on `codex/pipeline-run-page`  
**Impact**: No conflicts with these three branches  
**Action**: Can merge independently after these

---

## Contact & Questions

For questions about this merge plan:
- Phase 2 backend: Review `deployments/production/OIDC-CONFIGURATION.md`
- Phase 5 execution: Review the [Phase 5 implementation report](phase5-implementation-report.md)
- Phase 4 frontend: Review ADR-008 in `docs/architecture/decisions.md`

---

## Approval

**Ready for merge after**:
1. ✅ Phase 5 migration renumbered to 021
2. ✅ Phase 5 binary file removed
3. ✅ All pre-merge checklist items completed

**Merge window**: Recommend during low-activity period, allow 2-3 hours for full merge + verification.
