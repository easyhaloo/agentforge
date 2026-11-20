# E2E Testing Guide

## Overview

End-to-end (E2E) tests verify the complete user journey through the application, from frontend to backend. AgentForge uses [Playwright](https://playwright.dev/) for E2E testing.

## Why E2E Tests Are Mandatory

E2E tests are **critical** for AgentForge because:

1. **Domain Complexity**: Changeset/Revision/Evidence workflows have strict invariants
2. **Multi-Layer Integration**: React frontend + Go API + PostgreSQL
3. **User-Facing Correctness**: Prevents broken user flows from reaching production
4. **Regression Prevention**: Catches integration issues unit tests miss

## Test Execution Strategy

### Local Development

```bash
# Run all E2E tests
npm run test:e2e

# Run specific test file
npx playwright test tests/changeset-delivery.spec.ts

# Run in headed mode (see browser)
npx playwright test --headed

# Debug mode
npx playwright test --debug
```

### Pre-Push Hook

**E2E tests run automatically before every push** to ensure code quality:

```bash
# Normal push (runs E2E)
git push

# Skip E2E for quick iteration (use sparingly)
SKIP_E2E=1 git push
```

⚠️ **Important**: Skipped E2E tests **must** be run before merging to `main`.

### CI/CD

- **All branches**: E2E runs on every push in GitHub Actions
- **Pull Requests**: E2E must pass before merge
- **Main branch**: E2E runs on every commit

## Test Environment

### Prerequisites

1. **Frontend dev server** (port 5173)
2. **Backend API** (port 8080)
3. **PostgreSQL test database**

### Setup

```bash
# 1. Start test database
docker-compose -f docker-compose.test.yml up -d

# 2. Set environment variable
export DATABASE_URL='postgresql://agentforge:agentforge_dev_password@localhost:5433/agentforge_test'

# 3. Start backend (in one terminal)
cd backend/api
go run ./cmd/server

# 4. Start frontend (in another terminal)
npm run dev

# 5. Run E2E tests (in third terminal)
npm run test:e2e
```

### Configuration

E2E tests are configured in `playwright.config.ts`:

```typescript
{
  testDir: './tests',
  baseURL: 'http://localhost:5173',
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
  },
}
```

## Test Organization

```
tests/
├── changeset-delivery.spec.ts    # Changeset creation, revision, evaluation
├── review-workflow.spec.ts       # Review assignment, approval, rejection
├── merge-gates.spec.ts           # Merge validation and gate checks
├── organization-settings.spec.ts # Organization management
└── fixtures/                     # Test data and helpers
```

## Writing E2E Tests

### Test Structure

```typescript
import { test, expect } from '@playwright/test';

test.describe('Changeset Delivery Workflow', () => {
  test.beforeEach(async ({ page }) => {
    // Setup: navigate, login, seed data
    await page.goto('/orgs/current/changesets');
  });

  test('should create changeset and add revision', async ({ page }) => {
    // 1. Create changeset
    await page.click('[data-testid="create-changeset"]');
    await page.fill('[name="title"]', 'Fix navigation bug');
    await page.click('[data-testid="submit"]');

    // 2. Verify changeset created
    await expect(page.locator('.changeset-title')).toHaveText('Fix navigation bug');

    // 3. Add revision
    await page.click('[data-testid="add-revision"]');
    // ... test continues
  });
});
```

### Best Practices

1. **Test user flows, not implementation**
   - ✅ "User can create changeset and request review"
   - ❌ "CreateChangesetButton component renders"

2. **Use data-testid for selectors**
   ```tsx
   <button data-testid="create-changeset">Create</button>
   ```

3. **Verify domain invariants**
   - Evidence invalidation on new revision
   - Stale review detection
   - Merge gate validation

4. **Keep tests independent**
   - Each test should set up its own data
   - Don't depend on execution order

5. **Clean up after tests**
   - Use `test.afterEach()` to clean database
   - Reset application state

## Test Coverage Requirements

### Critical Paths (Must Have E2E Tests)

- [ ] **Changeset Delivery Flow**
  - Create changeset
  - Add revision
  - Run evaluation
  - Assign review
  - Approve/reject review
  - Merge changeset

- [ ] **Domain Invariants**
  - Revision invalidates evidence
  - Revision invalidates review
  - Merge gates (evidence + approval)
  - Stale evidence blocks approval

- [ ] **Organization Management**
  - Create organization
  - Manage members
  - Configure settings

- [ ] **Authentication & Authorization**
  - OIDC login flow
  - Role-based access control
  - Session management

### Nice to Have

- Repository management
- Pipeline creation and execution
- Merge queue operations
- UI responsiveness (mobile)

## Debugging E2E Failures

### Local Debugging

```bash
# Run with headed browser
npx playwright test --headed

# Debug mode (pauses execution)
npx playwright test --debug

# Generate trace for failed tests
npx playwright test --trace on
npx playwright show-trace trace.zip
```

### CI Debugging

Failed E2E tests in CI attach:
- Screenshots of failure
- Video recording
- Test trace
- Console logs

Access artifacts from GitHub Actions workflow run.

### Common Issues

**1. Test timeout**
```
Error: Test timeout of 30000ms exceeded
```
**Solution**: Increase timeout or optimize test
```typescript
test('slow operation', async ({ page }) => {
  test.setTimeout(60000); // 60s timeout
  // ... test code
});
```

**2. Element not found**
```
Error: locator.click: Target closed
```
**Solution**: Wait for element to be ready
```typescript
await page.waitForSelector('[data-testid="button"]');
await page.click('[data-testid="button"]');
```

**3. Backend not responding**
```
Error: connect ECONNREFUSED 127.0.0.1:8080
```
**Solution**: Ensure backend is running and DATABASE_URL is set

## Performance Optimization

### Strategies

1. **Parallelize tests**
   ```typescript
   // playwright.config.ts
   {
     workers: process.env.CI ? 2 : 4,
     fullyParallel: true,
   }
   ```

2. **Reuse authentication state**
   ```typescript
   // Setup file
   test.beforeAll(async ({ browser }) => {
     const context = await browser.newContext();
     // Perform login once
     await context.storageState({ path: 'auth.json' });
   });

   // Test file
   test.use({ storageState: 'auth.json' });
   ```

3. **Use API for setup when possible**
   ```typescript
   test.beforeEach(async ({ request }) => {
     // Seed data via API instead of UI
     await request.post('/api/v1/organizations/acme/changesets', {
       data: { title: 'Test changeset' }
     });
   });
   ```

### Expected Duration

| Environment | Duration |
|-------------|----------|
| Local (4 workers) | ~2-5 minutes |
| CI (2 workers) | ~5-10 minutes |

## Skip Strategy

### When to Skip E2E

**Acceptable** (use `SKIP_E2E=1`):
- Quick iteration on unrelated changes (CSS tweaks, docs)
- Work-in-progress commits on feature branch
- Local experiments

**NOT Acceptable**:
- Before merging to `main`
- After changing domain logic
- After changing API contracts
- After changing critical user flows

### Enforcement

Pre-push hook **allows skipping** E2E locally, but:
- CI **always runs** E2E
- PR **cannot merge** without passing E2E
- Main branch **always protected** by E2E

## Integration with Development Workflow

### Full Verification Before Push

```bash
# Option 1: Let pre-push hook run everything
git push

# Option 2: Manual verification
npm test              # Unit tests
npm run build         # Build check
npm run test:e2e      # E2E tests
git push
```

### Quick Iteration (Feature Branch)

```bash
# Fast iteration
SKIP_E2E=1 git push

# Before creating PR
npm run test:e2e      # Run skipped E2E
git push              # Push with confidence
```

### CI Stages

1. **Lint & Format**: ESLint, gofmt
2. **Unit Tests**: Vitest (frontend), go test (backend)
3. **Build**: npm run build
4. **E2E Tests**: Playwright
5. **Deploy**: (if all pass)

## Troubleshooting

### "Playwright not installed"

```bash
npx playwright install
```

### "Database connection failed"

```bash
# Check DATABASE_URL is set
echo $DATABASE_URL

# Verify database is running
docker-compose -f docker-compose.test.yml ps

# Restart database
docker-compose -f docker-compose.test.yml restart
```

### "Port already in use"

```bash
# Kill process on port 5173
lsof -ti:5173 | xargs kill -9

# Or use different port in playwright.config.ts
```

## Further Reading

- **[Playwright Documentation](https://playwright.dev/)** — Official Playwright docs
- **[Testing Guide](setup.md)** — General testing environment setup
- **[Frontend Development Guide](../development/frontend.md)** — Frontend testing practices
- **[CI/CD Documentation](../operations/pipeline-runners.md)** — CI pipeline details

---

**Remember**: E2E tests are the safety net for domain invariants. Don't skip them lightly.
