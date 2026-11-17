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
go run ./cmd/server
```

The server validates `PORT` and `DATABASE_URL` at startup, applies pending embedded SQL migrations, and attaches a validated `X-Request-ID` to every response. Safe incoming request IDs are preserved; invalid or oversized values are replaced.

## Health checks

- `GET /healthz` reports process health.
- `GET /readyz` reports database and identity readiness. It currently returns `503` until a production identity resolver is configured.

## Delivery API availability

Delivery routes are organization-scoped:

`/api/v1/organizations/{organizationID}/changesets`

They remain fail-closed until a production `PrincipalResolver` validates the user session, active organization membership, and role. The current server does not configure an identity resolver, so protected delivery routes return `503`. Do not add a development actor or bypass this boundary to make the UI appear operational.

Revision creation, evaluation, evidence attachment, and review operations also remain unavailable until their trusted provider/worker adapters are implemented.
