# Integration Tests

End-to-end integration tests for AgentForge authentication system.

## Overview

This directory contains integration tests that verify the complete authentication flow from frontend to backend, including:

- User registration with local authentication
- User login with password authentication
- OIDC SSO authentication flow
- Session management
- Error handling and edge cases

## Prerequisites

- **Docker** and **Docker Compose** - for running test database and API
- **Node.js 18+** - for running tests and frontend dev server
- **Go 1.21+** - for building the backend API
- **pnpm** - for managing dependencies

## Directory Structure

```
tests/integration/
├── README.md                    # This file
├── package.json                 # Test dependencies
├── vitest.config.ts             # Vitest configuration
├── setup-tests.ts               # Global test setup/teardown
├── setup.sh                     # Environment setup script
├── teardown.sh                  # Environment cleanup script
├── config/
│   ├── test.env                 # Environment variables
│   └── docker-compose.test.yml  # Docker services for testing
├── fixtures/
│   └── test-users.json          # Test user data
├── scripts/
│   └── load-fixtures.js         # Fixture loading script
└── auth/
    ├── login.test.ts            # Login flow tests
    └── registration.test.ts     # Registration flow tests
```

## Running Tests

### Quick Start

```bash
# From tests/integration directory
./setup.sh        # Start test environment
pnpm install      # Install dependencies
pnpm test         # Run all tests
./teardown.sh     # Clean up
```

### Full Test Suite

```bash
cd tests/integration
./setup.sh
pnpm test
./teardown.sh
```

### Individual Test File

```bash
./setup.sh
pnpm test auth/login.test.ts
./teardown.sh
```

### Watch Mode (for development)

```bash
./setup.sh
pnpm test:watch
# Stop with Ctrl+C when done
./teardown.sh
```

### Keep Environment Running

Useful for manual testing or debugging:

```bash
./setup.sh
# Environment is now running, you can:
# - Run tests manually
# - Explore the API at http://localhost:8081
# - Access the frontend at http://localhost:5174
# - Connect to the database at localhost:5433

# Don't forget to tear down when done
./teardown.sh
```

## Test Environment

When the integration test environment is running, the following services are available:

- **API Server**: http://localhost:8081
  - Health check: `GET /healthz`
  - API documentation: See backend/api/README.md

- **Frontend Dev Server**: http://localhost:5174
  - Full React application with hot reload

- **PostgreSQL Database**: localhost:5433
  - Database: `agentforge_test`
  - Username: `test_user`
  - Password: `test_password`

## Test Configuration

Environment variables are defined in `config/test.env`:

```bash
# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
POSTGRES_DB=agentforge_test
POSTGRES_USER=test_user
POSTGRES_PASSWORD=test_password

# API
API_PORT=8081
API_BASE_URL=http://localhost:8081

# Frontend
WEB_PORT=5174
WEB_BASE_URL=http://localhost:5174

# Test settings
TEST_TIMEOUT=30000
```

## Test Data (Fixtures)

Test users are defined in `fixtures/test-users.json` and loaded automatically by `setup.sh`:

```json
{
  "users": [
    {
      "email": "test@example.com",
      "password": "TestPassword123!",
      "display_name": "Test User"
    },
    {
      "email": "existing@example.com",
      "password": "ExistingPass456!",
      "display_name": "Existing User"
    }
  ]
}
```

## Writing New Tests

Create a new test file in the appropriate directory (e.g., `auth/new-feature.test.ts`):

```typescript
import { describe, it, expect } from 'vitest';
import { apiRequest, API_BASE_URL } from '../setup-tests';

describe('New Feature', () => {
  it('should do something', async () => {
    const response = await apiRequest('/api/endpoint', {
      method: 'POST',
      body: JSON.stringify({ data: 'value' }),
    });

    expect(response.ok).toBe(true);
    const result = await response.json();
    expect(result).toMatchObject({ expected: 'value' });
  });
});
```

Helper functions available in `setup-tests.ts`:

- `apiRequest(path, options)` - Make API requests
- `authenticatedRequest(path, token, options)` - Make authenticated API requests
- `API_BASE_URL` - API server base URL
- `WEB_BASE_URL` - Frontend server base URL

## Troubleshooting

### Setup fails with "Services failed to become healthy"

Check Docker logs:
```bash
cd tests/integration/config
docker-compose -f docker-compose.test.yml logs
```

Common issues:
- Port conflicts (5433, 8081, 5174 already in use)
- Docker daemon not running
- Insufficient resources

### Frontend fails to start

Check the frontend log:
```bash
cat /tmp/integration-web.log
```

Common issues:
- Port 5174 already in use
- Missing dependencies (run `pnpm install` in apps/web)
- Build errors in the frontend code

### Tests fail with connection errors

Verify services are running:
```bash
curl http://localhost:8081/healthz
curl http://localhost:5174
```

If services aren't responding, restart the environment:
```bash
./teardown.sh
./setup.sh
```

### Database migration errors

Check the migration status manually:
```bash
cd ../../backend/api
export DATABASE_URL="postgres://test_user:test_password@localhost:5433/agentforge_test?sslmode=disable"
go run ./cmd/migrate/main.go status
```

### Cleaning up stuck processes

```bash
# Kill processes on test ports
lsof -ti:5433,8081,5174 | xargs kill -9

# Remove Docker containers and volumes
cd tests/integration/config
docker-compose -f docker-compose.test.yml down -v
```

## CI/CD Integration

To run integration tests in CI:

```yaml
# Example GitHub Actions workflow
jobs:
  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - uses: actions/setup-go@v4
        with:
          go-version: '1.21'
      
      - name: Install dependencies
        run: |
          cd tests/integration
          pnpm install
      
      - name: Run integration tests
        run: |
          cd tests/integration
          ./setup.sh
          pnpm test
          ./teardown.sh
```

## Best Practices

1. **Always run setup before tests**: The test environment must be running
2. **Always run teardown after tests**: Clean up resources
3. **Use fixtures for test data**: Don't create hardcoded test data in tests
4. **Test real user flows**: Simulate actual user interactions
5. **Check response status and content**: Verify both success and error cases
6. **Clean up test data**: Each test should be independent
7. **Use descriptive test names**: Make failures easy to understand

## Support

For questions or issues:
- Check the troubleshooting section above
- Review backend API docs: `backend/api/README.md`
- Check project documentation: `docs/`
- Ask in the team chat or create an issue
