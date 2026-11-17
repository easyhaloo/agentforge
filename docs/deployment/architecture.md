# AgentForge Deployment Architecture

## Current frontend deployment

The current Cloudflare project is a **Cloudflare Worker**, not a Cloudflare Pages project. It serves the React/Vite build output as Worker Static Assets. Production deployment is owned by Cloudflare Workers Builds through its direct Git integration; GitHub Actions is responsible for validation only.

- Worker name: `agentforge`
- Production route: `https://agentforge.gangshusheng.workers.dev`
- Frontend build command: `npm run build`
- Build output: `apps/web/dist/`
- Wrangler deployment command: `npx wrangler deploy`

## Cloudflare Workers Builds

| Setting | Value |
| --- | --- |
| Root directory | `/` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Production branch | `main` |

Cloudflare Workers Builds is the sole production deployment owner. Do not add a second GitHub Actions Wrangler deployment or use `wrangler pages deploy`.

## Backend deployment

The Go API is independent of the frontend Worker. Build from `backend/api`, deploy to a Go/container-capable runtime, configure PostgreSQL and object storage through server-side secrets, expose HTTPS health/readiness endpoints, and restrict CORS to intended frontend origins.

## CI/CD ownership

- **Frontend:** Cloudflare Workers Builds deploys from the repository's `main` branch.
- **GitHub Actions:** dependency installation, tests, production build and contract validation only.
- **Backend:** build/test in GitHub Actions and deploy through a separate Go hosting integration.
- **Contracts:** validate OpenAPI and keep the checked frontend client aligned.

Never commit credentials or expose backend secrets through frontend build variables.
