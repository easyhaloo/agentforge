# Backend Development Guide

This guide defines development standards for the Go API in `backend/api`.

## Architecture

### Package organization

```
backend/api/
├── cmd/                    # Executable entry points
│   ├── server/            # Main HTTP API server
│   ├── pipeline-worker/   # Background pipeline worker
│   └── bootstrap-owner/   # First-owner provisioning tool
├── internal/              # Private packages (not importable by external code)
│   ├── domain/           # Domain entities and business logic
│   ├── api/              # HTTP handlers, routing, middleware
│   ├── store/            # Data persistence (PostgreSQL)
│   ├── gitprovider/      # Git operations adapter
│   ├── evaluator/        # Changeset evaluation
│   └── auth/             # Authentication and session management
├── migrations/            # Embedded SQL migrations
├── ops/                   # Operational scripts and tools
├── go.mod                # Go module definition
└── README.md             # Operations and deployment guide
```

### Design principles

- **Modular monolith**: logically separated domains in one deployable binary
- **Internal packages**: enforce encapsulation with `internal/`
- **Dependency direction**: `cmd → internal/api → internal/store/domain`
- **No cyclic dependencies**: packages must form a directed acyclic graph
- **Domain-first**: business logic in `internal/domain/`, not scattered in handlers

## Code style

### Formatting

- Run `go fmt` before commit (enforced by pre-push hook)
- Use `gofmt -s` for simplified code
- Consider `goimports` for import organization

### Naming conventions

- **Packages**: lowercase, no underscores (e.g., `gitprovider`, not `git_provider`)
- **Interfaces**: single-method interfaces often end with `-er` (e.g., `Store`, `Evaluator`)
- **Acronyms**: consistent case (e.g., `userID` or `UserID`, not `userId`)
- **Exported vs unexported**: only export what callers need

### Code organization

- **Group by feature/domain**, not by layer (avoid `models/`, `controllers/`, `services/` anti-pattern)
- **Keep files focused**: one primary type or workflow per file
- **Limit file size**: split files over ~500 lines into logical units
- **Colocation**: tests next to implementation (`store_test.go` near `store.go`)

## Error handling

### Wrapping errors

Always wrap errors with context using `fmt.Errorf` and `%w`:

```go
user, err := store.GetUser(ctx, id)
if err != nil {
    return fmt.Errorf("failed to get user %s: %w", id, err)
}
```

### Sentinel errors

Use sentinel errors for expected conditions that callers should handle:

```go
var ErrNotFound = errors.New("not found")
var ErrVersionConflict = errors.New("version conflict")

// Usage
if errors.Is(err, store.ErrNotFound) {
    return problem.NotFound(...)
}
```

### Custom error types

For errors needing structured data:

```go
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("%s: %s", e.Field, e.Message)
}
```

### Logging errors

- Log errors at **boundaries** (HTTP handlers, workers), not every layer
- Include context (request ID, user ID, resource ID)
- Never log sensitive data (passwords, tokens, PII)

## Database

### Migrations

- Location: `backend/api/migrations/`
- Format: `NNN_description.sql` (e.g., `001_initial_schema.sql`)
- Auto-applied on server startup (embedded in binary)
- **Never edit applied migrations** — create a new migration to alter schema
- Use transactions for DDL when possible

### Queries

**Always use parameterized queries** to prevent SQL injection:

```go
// ✅ Correct: parameterized
rows, err := db.Query("SELECT * FROM users WHERE email = $1", email)

// ❌ Wrong: string concatenation (SQL injection risk)
rows, err := db.Query("SELECT * FROM users WHERE email = '" + email + "'")
```

### Transactions

Standard transaction pattern:

```go
tx, err := db.BeginTx(ctx, nil)
if err != nil {
    return err
}
defer tx.Rollback() // Safe to call even after commit

// ... do work with tx ...

if err := tx.Commit(); err != nil {
    return fmt.Errorf("commit failed: %w", err)
}
return nil
```

### Schema design principles

- Use UUIDs for primary keys (user-facing IDs)
- Add `created_at` and `updated_at` timestamps
- Use `version` column for optimistic locking on mutable entities
- Index foreign keys and frequently filtered columns
- Use `NOT NULL` with defaults where appropriate
- Document enum-like columns with CHECK constraints

## API design

### RESTful conventions

- **Resource-oriented URLs**: `/api/v1/organizations/{org}/changesets`
- **HTTP methods**: GET (read), POST (create), PUT/PATCH (update), DELETE (remove)
- **Pluralized resources**: `/changesets`, not `/changeset`
- **Nested resources**: only when child cannot exist without parent
- **Query params**: for filtering, pagination, sorting

### Problem responses (RFC 7807)

Return structured errors using problem response format:

```go
{
  "type": "https://agentforge.dev/problems/version-conflict",
  "title": "Version Conflict",
  "status": 409,
  "detail": "Expected version 3, got version 2",
  "instance": "/api/v1/organizations/acme/changesets/cs_123"
}
```

Status codes:
- `200` OK (success with body)
- `201` Created (new resource)
- `204` No Content (success without body)
- `400` Bad Request (client error, invalid input)
- `401` Unauthorized (authentication required)
- `403` Forbidden (authenticated but not authorized)
- `404` Not Found
- `409` Conflict (version conflict, duplicate)
- `422` Unprocessable Entity (semantic validation failed)
- `500` Internal Server Error (unexpected server error)
- `503` Service Unavailable (dependency unavailable)

### Versioning

- API prefix: `/api/v1/`
- Breaking changes require new version (`/api/v2/`)
- Non-breaking changes (new fields, new endpoints) stay in current version

### Pagination

Standard pattern for list endpoints:

- **Request**: `?limit=20&offset=0` (default limit: 20, max: 100)
- **Response**:
  ```json
  {
    "items": [...],
    "total": 142,
    "limit": 20,
    "offset": 0
  }
  ```

### Filtering

- Use query parameters: `?status=in_review&repository=owner/repo`
- Combine filters with AND logic
- Document allowed filter values
- Return `400` for invalid filter values

## Testing

### Test organization

- **Unit tests**: next to implementation (`store_test.go`, `changeset_test.go`)
- **Integration tests**: require external dependencies (database, Docker)
- **Table-driven tests**: for multiple test cases

Example:

```go
func TestChangesetStatus(t *testing.T) {
    tests := []struct {
        name     string
        input    Changeset
        expected Status
    }{
        {"no revision", Changeset{}, StatusDraft},
        {"revision but no eval", Changeset{CurrentRevision: "rev1"}, StatusEvaluationPending},
        // ...
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := tt.input.DeriveStatus()
            if got != tt.expected {
                t.Errorf("got %v, want %v", got, tt.expected)
            }
        })
    }
}
```

### Test requirements

- **DATABASE_URL must be set** for integration tests (see [Testing Guide](../testing/setup.md))
- Tests without DATABASE_URL are skipped with clear message
- Use transactions in tests and rollback for isolation
- Clean up resources (temp files, goroutines)

### Coverage target

- **Domain logic**: aim for >80% coverage
- **HTTP handlers**: cover success, validation errors, auth errors
- **Store layer**: test queries, transactions, conflicts
- Run: `go test -cover ./...`

### Mocking

- Mock external dependencies (Git commands, Docker, external APIs)
- Use interfaces for test seams
- Consider [testify/mock](https://github.com/stretchr/testify) or manual mocks
- Don't mock database — use real PostgreSQL in tests

## Security

### Input validation

- Validate at API boundary (handlers), not deep in business logic
- Reject invalid input early with `400` or `422`
- Use allowlists over denylists for enum-like values
- Validate length, format, range constraints

### SQL injection prevention

- **Always use parameterized queries** (see Database section)
- Never concatenate user input into SQL strings
- Use query builders if needed, but prefer plain SQL with parameters

### Authentication and authorization

- **Session + CSRF** for write operations
- Validate session on every authenticated request
- Check organization membership and role before accessing resources
- Never trust client-supplied user/org IDs — use session identity

### Secrets management

- **Never log secrets** (passwords, tokens, API keys)
- Load secrets from environment variables or mounted secret files
- Use `REDACTED` placeholder in logs/errors for sensitive fields
- Rotate secrets regularly

### HTTPS enforcement

- Non-loopback `APP_ORIGIN` must use HTTPS
- CORS restricted to configured `APP_ORIGIN`
- Secure, HttpOnly, SameSite cookies for sessions

## Logging

### Structured logging

Use structured logging (library TBD — currently using standard `log` package):

```go
// Desired pattern (when structured logger is adopted):
logger.Info("changeset created",
    "changeset_id", cs.ID,
    "org_id", org.ID,
    "user_id", user.ID,
    "request_id", requestID,
)
```

### Log levels

- **ERROR**: action required, something is broken
- **WARN**: degraded operation, recoverable issue
- **INFO**: significant lifecycle events (server start, request handling)
- **DEBUG**: detailed diagnostic information (development only)

### What to log

- Request start/end with method, path, status, duration
- Validation errors (at DEBUG level)
- External service calls (duration, errors)
- Background job lifecycle (start, success, failure)

### What NOT to log

- Passwords, tokens, API keys
- Full request/response bodies (may contain PII)
- Personally identifiable information (email, names, unless required for audit)

## Dependencies

### Adding dependencies

- Use `go get <module>@<version>` to add
- Pin to specific versions, not `@latest`
- Review licenses and security advisories
- Prefer standard library over external deps when reasonable

### Dependency guidelines

- Avoid dependencies with many transitive dependencies
- Prefer mature, actively maintained libraries
- Use go.mod `replace` directives only for local development

## Configuration

### Environment variables

Document all environment variables in `backend/api/.env.example`.

Required variables:
- `DATABASE_URL`: PostgreSQL connection string
- `PORT`: HTTP listen port
- `APP_ORIGIN`: Frontend origin for CORS and cookies

Optional variables (feature flags):
- `GIT_REPOSITORY_ROOT`: enables Git operations
- `EVIDENCE_ROOT`: enables evidence storage
- `OIDC_*`: enables SSO authentication
- `PIPELINE_*`: enables pipeline features

### Configuration validation

- Validate required config at startup
- Fail fast with clear error messages
- Never use default values for security-sensitive config (secrets, origins)

## Performance

### Query optimization

- Use indexes for filtered columns
- Avoid N+1 queries (use JOINs or batch loading)
- Use `EXPLAIN ANALYZE` to profile slow queries
- Consider pagination for large result sets

### Connection pooling

- Use `sql.DB` connection pool (default in standard library)
- Configure `SetMaxOpenConns`, `SetMaxIdleConns` based on load
- Monitor connection pool metrics

### Context timeouts

Set reasonable timeouts for external operations:

```go
ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
defer cancel()
```

## Common patterns

### Optimistic locking

For concurrent updates, use version field:

```go
UPDATE changesets 
SET title = $1, version = version + 1, updated_at = NOW()
WHERE id = $2 AND version = $3
RETURNING version
```

If no rows affected, return `409 Conflict`.

### Audit trails

Append-only audit events for important state changes:

```go
INSERT INTO changeset_audit(changeset_id, event_type, actor_id, details, created_at)
VALUES ($1, $2, $3, $4, NOW())
```

### Request ID tracking

Attach `X-Request-ID` to every request and include in all logs:

```go
requestID := middleware.GetRequestID(ctx)
log.Printf("[%s] handling request", requestID)
```

## Further reading

- **Operations guide**: [backend/api/README.md](../../backend/api/README.md)
- **API architecture**: [docs/architecture/overview.md](../architecture/overview.md)
- **Testing setup**: [Testing Guide](../testing/setup.md)
- **Deployment**: [docs/deployment/architecture.md](../deployment/architecture.md)
