# Git Hooks Installation

## Pre-push Hook

The pre-push hook enforces code quality by running:
1. **Go code formatting check** - Ensures all Go files are properly formatted with `gofmt`
2. **Backend tests** - Runs full Go test suite (requires DATABASE_URL)
3. **Frontend tests** - Runs frontend test suite (if apps/web exists)

## Installation

Run the installation script from the repository root:

```bash
./scripts/install-git-hooks.sh
```

This will copy all hooks from `scripts/hooks/` to `.git/hooks/` and make them executable.

## Requirements

### For Backend Tests
The pre-push hook requires a PostgreSQL database to run backend tests.

**Option 1: Use make dev**
```bash
# In a separate terminal
make dev

# This sets DATABASE_URL automatically
```

**Option 2: Manual setup**
```bash
# Start PostgreSQL (via Docker, brew, etc.)
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=agentforge postgres:15

# Set DATABASE_URL
export DATABASE_URL='postgres://agentforge:agentforge@localhost:5432/agentforge_test?sslmode=disable'

# Or add to ~/.zshrc or ~/.bashrc
echo 'export DATABASE_URL="postgres://agentforge:agentforge@localhost:5432/agentforge_test?sslmode=disable"' >> ~/.zshrc
```

### For Frontend Tests
```bash
cd apps/web
npm install
npm test -- --run
```

## Bypassing Hooks (Not Recommended)

If you need to bypass hooks in exceptional circumstances:
```bash
git push --no-verify
```

**Warning**: Bypassing hooks may cause CI failures. Only use this if you have a specific reason and understand the consequences.

## Troubleshooting

### "DATABASE_URL is not set"
The pre-push hook will fail if DATABASE_URL is not set. See the Requirements section above.

### "Tests failed"
Fix the failing tests before pushing. Run tests locally:
```bash
# Backend
cd backend/api
go test ./...

# Frontend
cd apps/web
npm test
```

### Hook not running
Re-run the installation script:
```bash
./scripts/install-git-hooks.sh
```

## Files

- `scripts/hooks/pre-push` - Pre-push hook template (tracked in git)
- `scripts/install-git-hooks.sh` - Installation script (tracked in git)
- `.git/hooks/pre-push` - Installed hook (not tracked, local only)

The hook templates in `scripts/hooks/` are tracked in git and shared across the team. Each developer must run the installation script to activate them locally.
