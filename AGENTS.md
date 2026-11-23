# AI Agents Development Guide for AgentForge

**This document is for ALL AI agents and coding assistants working on this repository**, not just Claude Code.

## Reading Order for AI Agents

1. **This file (AGENTS.md)** ← MANDATORY first read: Core principles, domain rules, workflow
2. **[Agent Collaboration](docs/development/agent-collaboration.md)** ← Required for Codex-led development and Claude Code implementation
3. **[CLAUDE.md](CLAUDE.md)** ← Claude Code-specific configuration (if using Claude Code)
4. **[docs/development/frontend.md](docs/development/frontend.md)** ← When working on apps/web (React/TypeScript)
5. **[docs/development/backend.md](docs/development/backend.md)** ← When working on backend/api (Go)
6. **[Testing Guide](docs/testing/setup.md)** ← Test environment setup (required for backend tests)

## Document Roles

| Document | Audience | Purpose |
|----------|----------|---------|
| **AGENTS.md** | All AI agents | Universal AI development standards, domain rules, workflow |
| **CLAUDE.md** | Claude Code | Claude Code-specific configuration |
| **README.md** | Human developers | Project overview, quick start |
| **CONTRIBUTING.md** | Human contributors | Contribution guidelines (when created) |
| **docs/development/** | AI & humans | Detailed frontend/backend development guides |

## Core Principles for AI Agents

### 1. Read Before Acting

**Always read relevant code before making claims or changes:**
- ✅ Read the file you're about to edit
- ✅ Read related files (imports, callers)
- ✅ Search for similar patterns in the codebase
- ❌ Never guess file contents or API shapes
- ❌ Never claim "I've verified" without actually running the check

### 2. Verify After Acting

**Run checks before presenting results:**
- ✅ Run tests: `npm test` (frontend), `go test ./...` (backend)
- ✅ Run build: `npm run build` (frontend), `go build` (backend)
- ✅ Check types: TypeScript compiler will error on `npm run build`
- ❌ Never claim tests pass without running them
- ❌ Never say "this should work" — prove it works

### 3. Surgical Changes

**Touch only what you must:**
- ✅ Make the smallest coherent change
- ✅ Keep related changes in one commit
- ❌ Don't refactor adjacent code "while you're there"
- ❌ Don't "improve" unrelated formatting or naming
- ❌ Don't remove pre-existing dead code unless asked

**When your change creates orphans:**
- ✅ Remove imports/variables/functions YOUR changes made unused
- ❌ Don't remove pre-existing dead code

### 4. Goal-Driven Execution

**Define success criteria before starting:**

Transform vague tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, verify it fails, then make it pass"
- "Refactor X" → "Extract component, ensure tests still pass"

### 5. Pilot Before Loop

**For bulk operations, test one first:**
- ✅ Run the first call standalone
- ✅ Parse its actual response (not just exit code)
- ✅ Verify the output format matches expectations
- ❌ Don't loop 100 times if the first one would have failed

## Documentation Placement (Critical)

⚠️ **AI agents frequently misplace documentation.** Follow these rules strictly:

### Quick Reference

| Document Type | Location | Example |
|---------------|----------|---------|
| Project standards (README, LICENSE) | `/` | `/README.md`, `/LICENSE.md` |
| AI entry guides | `/` | `/agent.md`, `/AGENTS.md`, `/CLAUDE.md` |
| Testing setup | `/docs/testing/setup.md` | `/TESTING.md` in root |
| Development standards | `/docs/development/` | `/docs/development/backend.md` |
| Architecture, ADRs | `/docs/architecture/` | `/docs/architecture/decisions.md` |
| Deployment guides | `/docs/deployment/` | `/docs/deployment/kubernetes.md` |
| Operations, runbooks | `/docs/operations/` | `/docs/operations/pipeline-runners.md` |
| Product specs | `/docs/product/` | `/docs/product/cicd-product-design.md` |
| Planning, roadmaps | `/docs/plans/` | `/docs/plans/development-roadmap.md` |
| Package-specific | `<package>/README.md` | `/backend/api/README.md` |

### Decision Tree

```
Is it README, LICENSE, CONTRIBUTING, or AI guide (agent.md, AGENTS.md, CLAUDE.md)?
├─ YES → Root directory (/)
└─ NO → Continue

Is it development standards (code style, testing, patterns)?
├─ YES → /docs/development/<topic>.md
└─ NO → Continue

Is it architecture or design decisions (ADRs)?
├─ YES → /docs/architecture/<topic>.md
└─ NO → Continue

Is it deployment or infrastructure?
├─ YES → /docs/deployment/<topic>.md
└─ NO → Continue

Is it operations or runbooks?
├─ YES → /docs/operations/<topic>.md
└─ NO → Continue

Is it product requirements or specs?
├─ YES → /docs/product/<topic>.md
└─ NO → Continue

Is it planning or roadmap?
├─ YES → /docs/plans/<topic>.md
└─ NO → Continue

Is it package-specific operations?
├─ YES → <package>/README.md (append or link to docs/)
└─ NO → Ask user before creating
```

### Common Mistakes to Avoid

❌ **Wrong:**
```
backend/api/DEVELOPMENT.md           # Should be docs/development/backend.md
apps/web/GUIDE.md                    # Should be docs/development/frontend.md
docs/backend-standards.md            # Should be docs/development/backend.md
ARCHITECTURE.md                      # Should be docs/architecture/overview.md
GIT_WORKFLOW.md                      # Should be docs/development/git-workflow.md
.claude/agent-guide.md               # Should be root agent.md
```

✅ **Correct:**
```
docs/development/backend.md          # Backend development standards
docs/development/frontend.md         # Frontend development standards
docs/architecture/decisions.md       # Architecture Decision Records
docs/deployment/kubernetes.md        # Kubernetes deployment guide
backend/api/README.md                # API operations (deployment, config)
```

## Code Quality Standards

### TypeScript / Frontend

- **Strict mode**: Keep TypeScript strict mode enabled
- **No `any`**: Use explicit types, `unknown` with narrowing, or discriminated unions
- **i18n mandatory**: All user-facing text must be in translation files (en-US and zh-CN)
- **No hardcoded strings**: Use `useTranslation()` and `t()` for all UI text
- **Routing rules**: Update `app/routes.tsx`, `app/navigation.ts`, route tests, and ADR-008 together
- **Feature-Sliced**: Follow the [frontend architecture](docs/development/frontend.md#frontend-architecture)

### Go / Backend

- **gofmt**: All Go code must be formatted (enforced by pre-push hook)
- **Parameterized queries**: Always use `$1, $2` placeholders, never string concatenation
- **Error wrapping**: Use `fmt.Errorf("context: %w", err)` to preserve error chain
- **No ORM**: Use direct SQL with database/sql
- **Test with real DB**: Tests require `DATABASE_URL` (see [Testing Guide](docs/testing/setup.md))

## Product Context

### Product Identity

AgentForge is an **Agent-native Source Control & Verified Change Platform**. It is not an Agent Runtime and should not be reduced to an AI-themed GitHub clone.

### Non-negotiable Domain Distinctions

These are binding constraints for all implementation work:

- **Git Commit**: an immutable Git object identified by its full commit SHA
- **Changeset**: a stable product-level unit of proposed change, with its own stable ID
- **Revision**: an iteration of a Changeset. A new Revision does not create a new Changeset identity
- **Evidence**: evaluation output bound to the exact Revision it evaluated
- **Review decision**: approval or requested changes bound to the exact Revision reviewed
- **Trail**: the traceable sequence of work and evidence associated with delivery

**Never:**
- Use a Changeset ID as a Git commit SHA or Revision ID
- Treat evidence or approval for an older Revision as valid for the current Revision

## Domain Invariants (Critical)

These rules are **non-negotiable** and enforced by domain logic, not just UI:

1. **Changeset** keeps stable identity across revisions
2. **Revision** invalidates prior evidence and reviews
3. **Evidence** is current only when `revisionId` equals active Revision
4. **Approval** requires passing evidence for active Revision
5. **Merge** requires passing evidence + approved review for same active Revision
6. Failed, missing, or stale evaluation must block approval and merge
7. Review decision for older Revision must never authorize merging newer Revision
8. Revision has at most one active review (assigning new review supersedes pending one)

Keep these rules in domain functions, not only in disabled buttons or UI. See [docs/development/frontend.md](docs/development/frontend.md) for complete workflow rules.

## Git Workflow

### Commit Format

**Required**: `type(scope): description`

```
feat(backend): add merge queue promotion API
fix(frontend): correct Revision binding in Evidence display
refactor(delivery): extract approval gate to domain
test(backend): add integration tests for pipeline runs
docs(development): add backend development guide
```

**Types**: feat, fix, refactor, test, docs, chore

**Scopes**: frontend, backend, api, ci, delivery, pipelines, i18n

### Branch Strategy

- Branch from: `main`
- Naming: `feature/<desc>`, `fix/<desc>`, `refactor/<desc>`
- Merge: Squash merge via PR

### Safety Rules

**NEVER use:**
- ❌ `git reset --hard` — Destroys uncommitted work
- ❌ `git clean -f` — Deletes untracked files permanently
- ❌ `git push --force` to main — Protected branch

**Always use:**
- ✅ `git pull --rebase` before push
- ✅ `git reset --soft HEAD~1` or `--mixed` to undo commits safely
- ✅ `git restore --staged` to unstage

**Reason**: Multiple concurrent AI sessions may have untracked work-in-progress files.

## Testing Requirements

### Frontend
```bash
npm test              # Vitest unit tests
npm run build         # TypeScript check + production build
npm run test:e2e      # Playwright E2E tests
```

### Backend
```bash
cd backend/api
go test ./...         # Requires DATABASE_URL
go build ./cmd/server # Compile check
```

### E2E Tests (Mandatory)

E2E tests verify complete user journeys and domain invariants. They are **mandatory** because:
- Domain complexity (Changeset/Revision/Evidence workflows)
- Multi-layer integration (React + Go + PostgreSQL)
- Prevents broken user flows reaching production

See [E2E Testing Guide](docs/testing/e2e.md) for complete documentation.

### Database Setup
```bash
# Start test database
docker-compose -f docker-compose.test.yml up -d

# Set environment variable
export DATABASE_URL='postgresql://agentforge:agentforge_dev_password@localhost:5433/agentforge_test'
```

See [Testing Guide](docs/testing/setup.md) for complete setup.

## Pre-Push Checks

The pre-push hook runs automatically and will **reject the push** if:
1. ❌ Documentation files are in wrong locations
2. ❌ Go code is not formatted (`gofmt`)
3. ❌ Go tests fail (`go test ./...`)
4. ❌ Frontend unit tests fail (`npm test`)
5. ❌ Frontend build fails (`npm run build`)
6. ❌ E2E tests fail (`npm run test:e2e`) - skip with `SKIP_E2E=1`

To bypass (not recommended): `git push --no-verify`  
To skip E2E only: `SKIP_E2E=1 git push` (must run before merging to main)

## Error Handling

### When Things Go Wrong

**After 2 failed attempts, diagnose root cause:**
- ✅ Explain what went wrong
- ✅ Try a fundamentally different approach
- ✅ Confirm with user if approach changes requirements
- ❌ Don't make incremental patches to the same failing approach

### Example

❌ **Wrong** (incremental patching):
```
Attempt 1: Try approach A → Error
Attempt 2: Tweak approach A slightly → Same error
Attempt 3: Tweak approach A again → Different error
```

✅ **Right** (diagnose and pivot):
```
Attempt 1: Try approach A → Error
Attempt 2: Tweak approach A → Same error
Diagnosis: Root cause is X, approach A won't work because Y
Attempt 3: Try approach B (fundamentally different) → Success
```

## Security Guidelines

### Input Validation
- Validate at API boundary (handlers), not deep in logic
- Use allowlists over denylists
- Reject invalid input with 400/422

### SQL Injection Prevention
```go
// ✅ Correct: parameterized
db.Query("SELECT * FROM users WHERE email = $1", email)

// ❌ Wrong: string concatenation (SQL injection!)
db.Query("SELECT * FROM users WHERE email = '" + email + "'")
```

### Secrets Management
- Never log secrets (passwords, tokens, API keys)
- Use environment variables or mounted secret files
- Use `REDACTED` placeholder in logs for sensitive fields

### Authentication
- Session + CSRF for writes
- Check organization membership and role
- Never trust client-supplied IDs

## Common Patterns

### Optimistic Locking (Backend)
```go
UPDATE changesets 
SET title = $1, version = version + 1, updated_at = NOW()
WHERE id = $2 AND version = $3
RETURNING version
```
If no rows affected → `409 Conflict`

### Feature Hooks (Frontend)
```typescript
// Feature-specific hook
export function useChangesetDelivery() {
  const [state, setState] = useState<DeliveryState>()
  // ... feature logic
  return { state, createRevision, requestReview, merge }
}
```

### Transaction Pattern (Backend)
```go
tx, err := db.BeginTx(ctx, nil)
if err != nil {
    return err
}
defer tx.Rollback() // Safe even after commit

// ... do work with tx ...

return tx.Commit()
```

## AI-Specific Guidance

### For All AI Agents

1. **Read this guide first** — It contains mandatory product constraints and the collaboration entry point
2. **Check Testing Guide** — Backend tests require DATABASE_URL (see docs/testing/setup.md)
3. **Follow domain rules** — Changeset/Revision/Evidence invariants are critical
4. **Verify changes** — Run tests and build before presenting results
5. **Document placement** — Use the decision tree above

### For Claude Code
- Also read [CLAUDE.md](CLAUDE.md) for Claude Code-specific configuration
- Use memory system for architecture decisions and known issues
- Delegate to sub-agents for broad investigations

### For Cursor, Copilot, Continue, etc.
- This file (AGENTS.md) is your primary configuration
- The product constraints above apply to all agents
- Follow the same verification and documentation rules

## Change Completion Checklist

Before marking work complete:

- [ ] Read relevant existing code
- [ ] Made minimal surgical changes
- [ ] Ran tests: `npm test` and/or `go test ./...`
- [ ] Ran build: `npm run build` and/or `go build`
- [ ] Verified domain invariants (if touching delivery workflow)
- [ ] Added/updated i18n translations (en-US and zh-CN) if UI text changed
- [ ] Updated tests for changed behavior
- [ ] Placed documentation in correct location (if added docs)
- [ ] Commit message follows format: `type(scope): description`
- [ ] No prohibited git commands used (`git reset --hard`, `git clean -f`)

## Mock Data and Integration Boundaries

This repository currently contains a frontend prototype with seeded data and browser-local persistence.

- Clearly label simulated actions and demo data as Mock, Demo, or local-only
- Do not claim local action created Git commit, ran remote CI, started Agent Runtime, sent review notification, or merged remote branch
- Keep fixtures separate from rendering logic
- Make mock behavior replaceable by real service adapters without rewriting UI
- If task adds real integration, document endpoint contract, error states, loading states

## Further Reading

- **[CLAUDE.md](CLAUDE.md)** — Claude Code configuration
- **[README.md](README.md)** — Project overview
- **[Testing Guide](docs/testing/setup.md)** — Test environment setup
- **[docs/development/frontend.md](docs/development/frontend.md)** — React/TypeScript development guide
- **[docs/development/backend.md](docs/development/backend.md)** — Go development guide
- **[docs/architecture/](docs/architecture/)** — Architecture and ADRs
- **[backend/api/README.md](backend/api/README.md)** — API operations guide

---

**Remember**: This platform is for AI agents to create verified changesets. The domain rules (Changeset/Revision/Evidence/Review) are the heart of the product. Understand them before making changes.
