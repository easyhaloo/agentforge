# AgentForge Deployment Architecture

## Current frontend deployment

The current Cloudflare project is a **Cloudflare Worker**, not a Cloudflare Pages project. It serves the React/Vite build output as Worker Static Assets. Production deployment is owned by Cloudflare Workers Builds through its direct Git integration; GitHub Actions is responsible for validation only.

- Worker name: `agentforge`
- Production route: `https://agentforge.gangshusheng.workers.dev`
- Frontend build command: `npm run build`
- Build output: `dist/`
- Wrangler deployment command: `npx wrangler deploy`

The repository now contains `wrangler.jsonc`, which declares the Worker name, compatibility date, Vite build output and SPA fallback:

```jsonc
{
  "name": "agentforge",
  "compatibility_date": "2026-11-17",
  "assets": {
    "directory": "./dist/",
    "not_found_handling": "single-page-application"
  }
}
```

Keep the compatibility date aligned with the repository runtime policy. The config intentionally has no Worker entrypoint or custom asset binding: this frontend is a static React SPA served directly through Workers Static Assets.

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

- **Frontend:** Cloudflare Workers Builds is the sole production deployment owner. Connect the repository directly in Cloudflare and configure `main` as the production branch. Cloudflare runs `npm run build` and `npx wrangler deploy` from its own build environment.
- **GitHub Actions:** run dependency installation, tests and production build as CI checks only. Do not add a Wrangler deploy job, Cloudflare API token secret, or Pages deployment workflow to this repository.
- **Backend:** use GitHub Actions for build/test and a separate deployment integration for the selected Go hosting provider.
- **Contracts:** validate OpenAPI and ensure generated/checked frontend client is current.

Do not run a second GitHub Actions deployment for the frontend. This repository currently keeps only `.github/workflows/ci.yml`; Cloudflare deployment runs independently through Cloudflare Workers Builds.
