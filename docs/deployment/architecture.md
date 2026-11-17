# AgentForge Deployment Architecture

## Current frontend deployment

The current Cloudflare project is a **Cloudflare Worker**, not Pages. It serves the Vite build as Worker Static Assets.

- Worker: `agentforge`
- Route: `https://agentforge.gangshusheng.workers.dev`
- Workers Builds root directory: repository root (`/`)
- Build command: `npm run build`
- Build output: `apps/web/dist/`
- Deploy command: `npx wrangler deploy`
- Wrangler config: root `wrangler.jsonc`

The root npm workspace installs dependencies and delegates frontend commands to `apps/web`. The root Wrangler config points static assets to `./apps/web/dist` and enables SPA fallback.

## Cloudflare Workers Builds

| Setting | Value |
| --- | --- |
| Root directory | `/` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Production branch | `main` |

Do not switch the project to Pages or use `wrangler pages deploy`. GitHub CI success does not prove the Cloudflare dashboard deployment succeeded; verify that separately before considering production deployment validated.

## Backend deployment (target)

The Go API is independent of the frontend Worker:
- Build from `backend/api`.
- Deploy to a Go/container-capable runtime.
- Configure PostgreSQL and object storage through server-side secrets.
- Expose HTTPS API, health and readiness endpoints.
- Configure public frontend API base URL and restrict CORS.
- Keep database credentials, Git provider tokens and signing keys server-side.

## CI/CD ownership

Use one production deployment mechanism per application. Frontend remains on Cloudflare Workers Builds unless that integration is explicitly disabled before moving to GitHub Actions/Wrangler. Backend deploys independently. CI validates the OpenAPI contract. No workflow should run a Pages deployment command.