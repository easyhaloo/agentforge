# Go API

## Requirements

- Go 1.25+
- Docker with Compose

## Run locally

Start PostgreSQL from the repository root:

```sh
docker compose up -d postgres
```

Export the API configuration (copy `.env.example` values into your shell; the Go process does not load dotenv files automatically):

```sh
export PORT=8080
export DATABASE_URL='postgres://agentforge:agentforge@localhost:5432/agentforge?sslmode=disable'
export APP_ORIGIN='http://localhost:5173'
go run ./cmd/server
```

The server validates `PORT`, `DATABASE_URL`, and the exact `APP_ORIGIN` at startup, applies pending embedded SQL migrations, and attaches a validated `X-Request-ID` to every response. Safe incoming request IDs are preserved; invalid or oversized values are replaced. Credentialed API CORS is restricted to `APP_ORIGIN`; non-loopback origins must use HTTPS.

## Health checks

- `GET /healthz` reports process health.
- `GET /readyz` reports database, identity, CSRF, and application-origin readiness. It currently returns `503` until all trusted dependencies are configured.

## Delivery API availability

Delivery routes are organization-scoped:

`/api/v1/organizations/{organizationID}/changesets`

The PostgreSQL store now implements session resolution against the hashed session token, expiry, revocation, active organization membership, and active organization state. State-changing API requests additionally require the exact configured `APP_ORIGIN`, matching CSRF cookie/header values, and a CSRF hash bound to the same active session. Session tokens and CSRF tokens are stored only as SHA-256 hashes. The server wires CSRF and CORS protection, but intentionally does not wire the session resolver until OIDC login/callback can create trusted sessions. Protected delivery routes therefore remain unavailable to end users. Do not add a development actor or bypass this boundary.

Session creation, resolution, CSRF validation, and revocation storage primitives are available for the upcoming OIDC callback and logout endpoints. Revision creation, evaluation, evidence attachment, and review operations also remain unavailable until their trusted provider/worker adapters are implemented.
