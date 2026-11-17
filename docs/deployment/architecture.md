# AgentForge Deployment Architecture

## Current frontend deployment

The current Cloudflare project is a **Cloudflare Worker**, not a Cloudflare Pages project. It serves the React/Vite build output as Worker Static Assets.

- Worker name: `agentforge`
- Production route: `https://agentforge.gangshusheng.workers.dev`
- Frontend build command: `npm run build`
- Build output: `dist/`
- Wrangler deployment command: `npx wrangler deploy`

The repository should contain a Wrangler configuration that declares the static asset directory. Example:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "agentforge",
  "compatibility_date": "2026-11-17",
  "assets": {
    "directory": "./dist/",
    "not_found_handling": "single-page-application"
  }
}
```

The actual compatibility date and configuration must be kept aligned with the installed Wrangler version and repository runtime policy.

## Cloudflare Workers Builds

For the existing Worker project, configure:

| Setting | Value |
| --- | --- |
| Root directory | `/` while the frontend remains at repository root |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Production branch | `main` |

After the frontend is moved to `apps/web`, update the build configuration to install/build from that application and ensure Wrangler resolves the correct configuration and asset directory. Do not change the Cloudflare root/build settings until that migration is ready.

Do not use `wrangler pages deploy` for this Worker.

## Backend deployment (target)

The Go API is a separate service and is not part of the current frontend Worker deployment.

- Build a Go binary or container from `backend/api`.
- Deploy to a Go/container-capable runtime.
- Configure production PostgreSQL and object storage through server-side secrets.
- Expose HTTPS API endpoint, health and readiness checks.
- Configure frontend's public API base URL as non-secret build/runtime configuration.
- Restrict CORS to intended frontend origins.
- Keep database credentials, Git provider tokens and signing keys server-side.

## CI/CD ownership

Use one production deployment mechanism per application:

- Frontend: existing Cloudflare Workers Builds, or GitHub Actions with Wrangler after explicitly disabling Cloudflare Git/Workers Builds deployment. Do not run both for the same production branch.
- Backend: GitHub Actions build/test plus deployment to the selected Go hosting provider.
- Contracts: validate OpenAPI and ensure generated/checked frontend client is current.

The existing Pages-specific workflow must not deploy to the current Worker project. Remove or replace it as part of CI/CD foundation work.
