# Claude Code Configuration for AgentForge

## Quick Start for AI Agents

**Mandatory reading order:**
1. **[AGENTS.md](AGENTS.md)** — Universal AI development standards, product context, domain rules (MUST read first)
2. **[Frontend Development](docs/development/frontend.md)** — When working on apps/web (React/TypeScript)
3. **[Backend Development](docs/development/backend.md)** — When working on backend/api (Go)
4. **This file** — Claude Code-specific configuration and constraints

## Related Projects

| Project | Path / `j` keyword | Purpose |
|---------|-------------------|---------|
| (None currently) | - | Add cross-project dependencies here |

## Tools and Infrastructure

### Version Control
- **Git platform**: GitHub (use `gh` CLI, not `glab`)
- **CI/CD**: GitHub Actions (`.github/workflows/ci.yml`)
- **Branch**: main (default)

### Package Management
- **Frontend**: npm (NOT pnpm) - each package manages dependencies independently
- **Backend**: Go modules
- **Structure**: Independent packages (no npm workspaces)
  - `apps/web/` - Frontend application (has its own node_modules)
  - `tests/integration/` - Integration tests (has its own node_modules)
  - Root directory has NO package.json or node_modules

## Git Workflow

### Branch Strategy
- **Main branch**: `main` (protected)
- **Feature branches**: `feature/<description>`, `fix/<description>`, `refactor/<description>`
- **Work in progress**: Use descriptive branch names, avoid generic `wip` or `temp`
- **Branch from**: Always branch from latest `main`

### Commit Message Format

**Required format**: `type(scope): description`

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code change without behavior change
- `test`: Adding or updating tests
- `docs`: Documentation only
- `chore`: Build, tooling, dependencies

**Scopes:**
- `frontend`: apps/web changes
- `backend`: backend/api changes
- `api`: API contracts, OpenAPI schemas
- `ci`: CI/CD configuration
- `docs`: Documentation structure
- `delivery`: Changeset delivery workflow
- `pipelines`: Pipeline features
- `i18n`: Internationalization

**Examples:**
```
feat(backend): add merge queue promotion API
fix(frontend): correct Revision identity binding in Evidence display
refactor(delivery): extract approval gate validation to domain layer
test(backend): add integration tests for organization pipeline runs
docs(development): add backend development guide
chore(deps): update React to 19.0.1
```

**Attribution:**
End commit messages with:
```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Merge Strategy
- **To main**: Squash merge via pull request
- **PR title**: Must follow commit message format (becomes squashed commit message)
- **PR description**: Include summary, testing notes, breaking changes if any
- **PR description attribution**: End with:
  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  ```

### Git Safety Rules

**NEVER use these commands:**
- ❌ `git reset --hard` — Silently discards uncommitted work and untracked files
- ❌ `git push --force` to main — Protected branch, will be rejected
- ❌ `git clean -f` without explicit user confirmation — Deletes untracked files permanently

**Always do:**
- ✅ `git pull --rebase` before pushing
- ✅ `git fetch origin && git rebase origin/main` to sync
- ✅ Use `git reset --soft HEAD~1` or `git reset --mixed HEAD~1` to undo commits while preserving work
- ✅ Use `git restore --staged <path>` to unstage files

**Rationale**: This machine runs multiple concurrent Claude sessions on shared repos. An untracked file might be another session's in-progress work.

## Documentation Placement Rules

⚠️ **AI agents MUST follow these rules when creating or moving documentation.**

### Document Location Matrix

| Document Type | Correct Location | Wrong Locations | Example |
|---------------|------------------|-----------------|---------|
| **Project overview** | `/README.md` | `/docs/README.md` | Project description, quick start |
| **AI guides** | `/AGENTS.md`, `/CLAUDE.md` | `/docs/AGENTS.md`, `/.claude/AGENTS.md`, `/agent.md` | Universal AI standards, Claude Code config |
| **Testing setup** | `/docs/testing/setup.md` | `/TESTING.md`, root `/*.md` | Test environment configuration |
| **Contributing guide** | `/CONTRIBUTING.md` | `/docs/CONTRIBUTING.md` | How to contribute (when created) |
| **Architecture docs** | `/docs/architecture/*.md` | `/docs/*.md`, `/architecture/*.md` | System design, ADRs |
| **Development guides** | `/docs/development/*.md` | `/docs/*.md`, root `/*.md` | Frontend/backend dev standards |
| **Deployment docs** | `/docs/deployment/*.md` | `/docs/*.md`, `/deploy/*.md` | Deployment guides, infra |
| **Operations docs** | `/docs/operations/*.md` | `/docs/*.md`, `/ops/*.md` | Runbooks, operational procedures |
| **Product specs** | `/docs/product/*.md` | `/docs/*.md`, `/specs/*.md` | Product requirements, designs |
| **Planning docs** | `/docs/plans/*.md` | `/docs/*.md`, `/plans/*.md` | Roadmaps, project plans |
| **API operations** | `/backend/api/README.md` | `/docs/api/README.md` | API deployment, configuration |
| **Package-specific** | `<package>/README.md` | `/docs/<package>/*.md` | Package-local documentation |

### Decision Tree for New Documentation

```
Is it a standard project file (README, LICENSE, CONTRIBUTING)?
├─ YES → Root directory (/)
└─ NO → Continue

Is it AI-specific rules or Claude Code config?
├─ YES → Root directory (/agent.md or /CLAUDE.md)
└─ NO → Continue

Is it development standards (code style, patterns, testing)?
├─ YES → /docs/development/<topic>.md
└─ NO → Continue

Is it architecture, design decisions, or ADRs?
├─ YES → /docs/architecture/<topic>.md
└─ NO → Continue

Is it deployment or infrastructure?
├─ YES → /docs/deployment/<topic>.md
└─ NO → Continue

Is it operational procedures or runbooks?
├─ YES → /docs/operations/<topic>.md
└─ NO → Continue

Is it product requirements or specifications?
├─ YES → /docs/product/<topic>.md
└─ NO → Continue

Is it planning, roadmap, or project management?
├─ YES → /docs/plans/<topic>.md
└─ NO → Continue

Is it specific to backend/api operations?
├─ YES → /backend/api/README.md (append or link)
└─ NO → Ask user for clarification
```

### Examples of Correct Placement

✅ **Correct:**
```
docs/development/backend.md          ← Backend development standards
docs/development/frontend.md         ← Frontend development standards
docs/development/git-workflow.md     ← Detailed Git workflow
docs/architecture/decisions.md       ← Architecture Decision Records
docs/deployment/kubernetes.md        ← Kubernetes deployment guide
backend/api/README.md                ← API operations and deployment
```

❌ **Wrong:**
```
backend/api/DEVELOPMENT.md           ← Should be docs/development/backend.md
docs/backend-guide.md                ← Should be docs/development/backend.md
docs/GIT_WORKFLOW.md                 ← Should be docs/development/git-workflow.md
ARCHITECTURE.md                      ← Should be docs/architecture/overview.md
api-guide.md                         ← Should be backend/api/README.md or docs/
```

### Documentation Cross-References

When linking between documents:
- Use **relative paths** from the current file
- Include the `.md` extension
- Use descriptive link text

Example:
```markdown
See [Backend Development Guide](docs/development/backend.md) for Go standards.
See [API Operations](../../backend/api/README.md) for deployment.
```

### Updating Documentation

When adding new development standards:
1. **Determine category** using the decision tree above
2. **Check for existing docs** in that category
3. **Update or create** the appropriate file
4. **Add reference** in `agent.md` or root `README.md` if it's essential reading
5. **Update this file** if the new doc establishes a pattern others should follow

## Agent Roles and Task Delegation

### Main Agent (Orchestrator) Responsibilities
- Manage task progress and track status
- Coordinate sub-tasks and resolve dependencies
- Report completion and blockers to user
- **Does NOT**: Dive into implementation details, perform git surgery, or manual fixes

### Sub-Agent (Implementer) Responsibilities
- Read requirements and implement solutions
- Write code, tests, and documentation
- Verify results (run tests, build)
- Report back with deliverables
- **Does NOT**: Re-delegate tasks or wait for the main agent to check their work

### When to Delegate
- **Parallel independent work**: Multiple features, multiple files, research + implementation
- **Broad investigation**: Searching across many files, deep codebase research
- **Side quests**: Tasks that shouldn't block the main thread

### When NOT to Delegate
- **Simple lookups**: Reading a specific file or function
- **A handful of tool calls**: Direct implementation is faster
- **Already delegated**: Don't duplicate work

## CI/CD Responsibilities

### CI Pipeline (GitHub Actions)
- **Lint**: ESLint for frontend, gofmt check for backend
- **Test**: npm test (frontend), go test (backend with DATABASE_URL)
- **Build**: npm run build (frontend), go build (backend)
- **On**: Push to any branch, pull request to main

### Deployment (Not yet automated)
- Manual deployment process
- See [docs/deployment/architecture.md](docs/deployment/architecture.md)

### Test Environment
- **Frontend**: npm test (Vitest)
- **Backend**: Requires DATABASE_URL (see [Testing Guide](docs/testing/setup.md))
- **E2E**: Playwright (configuration in playwright.config.ts)

## Memory System

Project memory is stored in `.claude/projects/-Users-shenggangshu-llm-agentforge/memory/`.

### When to Use Memory
- **Architecture decisions** not documented elsewhere
- **Known issues** and workarounds
- **User preferences** for this project (code style, patterns)
- **Debugging insights** that would help future sessions

### When NOT to Use Memory
- **Code structure** (already in the codebase)
- **Past fixes** (already in git history)
- **General knowledge** (not project-specific)
- **Temporary notes** (only matters for this conversation)

See global `~/.agents/wiki-protocol.md` for memory format.

## Environment-Specific Notes

### Development
- **Full stack**: `make dev` (starts PostgreSQL, API, and web server)
- **Frontend only**: `cd apps/web && npm run dev` (port 5173)
- **Backend only**: `cd backend/api && go run ./cmd/server` (port 8080, requires DATABASE_URL)
- **Database**: `docker compose up -d postgres` (port 5432)

### Testing
- **Frontend unit tests**: `cd apps/web && npm test`
- **Frontend E2E tests**: `cd apps/web && npm run test:e2e`
- **Backend tests**: Requires PostgreSQL with `DATABASE_URL` set (see [Testing Guide](docs/testing/setup.md))
- **Integration tests**: `cd tests/integration && npm test`
- **All checks**: `make test` (runs all frontend and backend tests)
- Pre-push hook enforces test execution

## Cross-Project Collaboration

### Project Jump
Use `j <keyword>` to switch between projects (autojump alias in ~/.zshrc).

### Adding Related Projects
When this project references another codebase:
1. Add entry to **Related Projects** table above
2. Use `j <keyword>` to verify the path
3. Commit the updated CLAUDE.md

## Known Constraints

### Frontend
- Routing rules are strict (ADR-008): Update `app/routes.tsx`, `app/navigation.ts`, route tests, and ADR-008 together
- i18n is mandatory: All user-facing text must have en-US and zh-CN translations
- No hardcoded strings in JSX

### Backend
- Database migrations are embedded and auto-applied
- No `gorm` or ORM: Use direct SQL with parameterization
- OIDC is optional during foundation work

### Testing
- DATABASE_URL must be set for backend tests (enforced by pre-push hook)
- Frontend tests run in CI without external dependencies
- E2E tests use Playwright

## Change Verification

Before finishing any task:
1. ✅ Run tests: `npm test` and/or `cd backend/api && go test ./...`
2. ✅ Run build: `npm run build` and/or `cd backend/api && go build ./cmd/server`
3. ✅ Check documentation: Created/updated files in correct locations per rules above
4. ✅ Verify git: Commit message format, no prohibited commands
5. ✅ Review diff: No unintended changes, no hardcoded strings, no dead code

## Further Reading

- **[agent.md](agent.md)** — Mandatory AI entry guide
- **[README.md](README.md)** — Project overview and quick start
- **[Testing Guide](docs/testing/setup.md)** — Test environment setup
- **[docs/development/](docs/development/)** — Development guides (frontend, backend, git-workflow)
- **[docs/architecture/](docs/architecture/)** — Architecture and decisions
- **[backend/api/README.md](backend/api/README.md)** — API operations guide
