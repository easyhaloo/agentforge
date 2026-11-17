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

## OIDC authentication

OIDC login is optional during local foundation work. When enabled, configure all four values together:

- `OIDC_ISSUER_URL`: the provider's discovery issuer URL.
- `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`: confidential client credentials.
- `OIDC_REDIRECT_URL`: the exact API callback URL registered with the provider, ending in `/auth/oidc/callback`.
- `SESSION_TTL`: optional duration from `5m` to `168h`; defaults to `12h`.

The provider must support OIDC discovery, Authorization Code flow, and PKCE S256. The API validates the ID-token signature, issuer, audience, time claims, and nonce using the provider's discovery/JWKS metadata. State, nonce, and PKCE verifier are held in short-lived Secure, HttpOnly, host-only cookies; the one-time state and nonce hashes are stored in PostgreSQL to prevent callback replay.

Routes:

- `GET /auth/oidc/login` starts login.
- `GET /auth/oidc/callback` validates the provider response and creates the application session.
- `POST /api/v1/auth/logout` revokes the current session and clears both session cookies. It requires the configured Origin and session-bound CSRF header/cookie.

If OIDC configuration is absent or provider discovery fails, login returns `503`, protected routes remain unavailable, and `/readyz` remains `503`. A successful OIDC login creates or updates a local user by the immutable `(issuer, subject)` pair; it does not grant organization membership. An operator-controlled first-owner/bootstrap step is still required before the user can access tenant-scoped delivery resources.
