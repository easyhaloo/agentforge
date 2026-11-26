# Testing Environment Setup

This guide covers the basic test environment setup for unit and integration tests.

**For E2E testing**, see [E2E Testing Guide](e2e.md).

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

> **The `agentforge_test` database is shared and dirty.** Many tests connect to
> it directly and leave their fixtures behind (fixed ids, retired slugs, short
> slugs). A dirty database can fail tests that pass on a fresh one — the
> failure messages point at fixture conflicts, not at the code under test.
> Reset it with:
>
> ```bash
> docker-compose -f docker-compose.test.yml down -v && docker-compose -f docker-compose.test.yml up -d
> ```
>
> When a test keeps failing only locally, reset the database before debugging
> the code. New tests should use per-run unique ids (see the lifecycle tests in
> `organization_lifecycle_test.go`).

### Run the task and object-storage integration tests

The PostgreSQL user needs `CREATEDB` because the task tests create and remove a scratch database per test. Set `TEST_MINIO_BINARY` to the absolute path of a MinIO server executable. The test starts and stops its own local MinIO instance.

```bash
# From backend/api, with DATABASE_URL and TEST_MINIO_BINARY set.
CI=true go test -count=1 -v ./internal/tasks ./internal/artifact
```

GitHub Actions provisions both dependencies and fails these tests if either is missing.

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
