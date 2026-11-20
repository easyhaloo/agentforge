# Testing Environment Setup

## Quick Start with Docker (Recommended)

The project provides a Docker Compose configuration for the test database.

### 1. Start the test database

```bash
docker-compose -f docker-compose.test.yml up -d
```

### 2. Set the DATABASE_URL environment variable

```bash
export DATABASE_URL='postgresql://agentforge:agentforge_dev_password@localhost:5433/agentforge_test'
```

Or add to your shell profile (~/.bashrc, ~/.zshrc, etc.):

```bash
echo 'export DATABASE_URL="postgresql://agentforge:agentforge_dev_password@localhost:5433/agentforge_test"' >> ~/.zshrc
source ~/.zshrc
```

### 3. Run tests

```bash
cd backend/api
go test ./...
```

## Alternative: Local PostgreSQL

If you prefer to use a local PostgreSQL installation:

1. Create a test database
2. Set DATABASE_URL to your local database:
   ```bash
   export DATABASE_URL='postgresql://your_user:your_password@localhost:5432/your_database'
   ```

## Why is DATABASE_URL Required?

**Local tests and CI must run the same tests.** Without DATABASE_URL:
- Database-related tests are SKIPPED locally
- Code may pass locally but FAIL in CI
- This wastes time and breaks the development flow

The pre-push hook will **reject pushes** if DATABASE_URL is not configured to ensure test consistency.

## Troubleshooting

### Check if the test database is running

```bash
docker-compose -f docker-compose.test.yml ps
```

### View database logs

```bash
docker-compose -f docker-compose.test.yml logs postgres-test
```

### Stop the test database

```bash
docker-compose -f docker-compose.test.yml down
```

### Reset the test database (clean slate)

```bash
docker-compose -f docker-compose.test.yml down -v
docker-compose -f docker-compose.test.yml up -d
```
