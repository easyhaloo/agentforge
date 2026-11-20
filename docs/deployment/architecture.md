# AgentForge Deployment Architecture

## Frontend deployment

The current Cloudflare project is a **Cloudflare Worker** serving the React/Vite build output as Worker Static Assets. Cloudflare Workers Builds owns production deployment through direct Git integration.

- Worker name: `agentforge`
- Production URL: `https://agentforge.gangshusheng.workers.dev`
- Root directory: `apps/web`
- Build command: `npm run build`
- Build output: `dist/`
- Worker configuration: `apps/web/wrangler.jsonc`
- Production branch: `main`

The frontend is an independent package, so the Cloudflare build root is `apps/web`, not the repository root. Cloudflare Workers Builds installs the `apps/web` dependencies from the committed `apps/web/package-lock.json`, runs `npm run build`, and then deploys with `npx wrangler deploy`; `apps/web/wrangler.jsonc` resolves `main: ./src/worker.ts` and `assets.directory: ./dist/` relative to that root directory. Pointing the build root at the repository root breaks the build, because the repository root has no `package.json` and no `wrangler.jsonc`.

Cloudflare Workers Builds is the sole frontend deployment owner. Do not add a second GitHub Actions Wrangler deployment or use `wrangler pages deploy`.

## Backend deployment (deferred)

Backend deployment is intentionally **paused**. The Go API is not automatically deployed by GitHub Actions at this stage. The production target remains Google Cloud Run, using a container built from `backend/api/Dockerfile`, but deployment will be re-enabled only after the required cloud infrastructure and credentials have been provisioned and deployment is explicitly resumed.

The intended runtime baseline is:

- Cloud Run service: `agentforge-api`
- Container port: `8080`
- Health endpoint: `GET /healthz`
- Readiness endpoint: `GET /readyz`
- Database: Supabase PostgreSQL, using its connection pooler where appropriate
- Schema migrations: embedded SQL migrations are applied by the API during startup under a PostgreSQL advisory transaction lock
- Runtime secrets: Google Secret Manager; never put credentials in GitHub variables, source files, or frontend build configuration

The container runs as the non-root user in a distroless runtime image. The proposed Cloud Run baseline uses zero minimum instances and a maximum of three instances; this is a low-cost development/early-production baseline, not an availability guarantee.

### Prerequisites before resuming deployment

Before reintroducing a backend deployment workflow:

1. Create or configure a Google Cloud project with billing enabled and the Cloud Run, Cloud Build, Artifact Registry, IAM Credentials, and Secret Manager APIs enabled.
2. Create an Artifact Registry Docker repository in the selected region.
3. Configure a GitHub Workload Identity Federation provider and a deployer service account. Restrict the provider attribute condition to this repository and the intended GitHub branch/environment.
4. Grant the deployer service account permission to build with Cloud Build, write to the Artifact Registry repository, deploy Cloud Run services, and act as the Cloud Run runtime service account.
5. Grant the Cloud Run runtime service account `Secret Manager Secret Accessor` on the required secrets.
6. Create these Secret Manager secrets and add their values:
   - `AGENTFORGE_DATABASE_URL`: Supabase PostgreSQL pooler connection string with TLS enabled.
   - `AGENTFORGE_OIDC_ISSUER_URL`
   - `AGENTFORGE_OIDC_CLIENT_ID`
   - `AGENTFORGE_OIDC_CLIENT_SECRET`
   - `AGENTFORGE_OIDC_REDIRECT_URL`: the public Cloud Run URL plus `/auth/oidc/callback`.
7. Configure the OIDC provider's allowed callback URL to exactly match `AGENTFORGE_OIDC_REDIRECT_URL`.

When deployment is resumed, prefer GitHub Actions Workload Identity Federation (OIDC) over long-lived service-account JSON keys. Do not commit credentials or expose backend secrets through frontend build variables.

The initial deployment requires the OIDC callback URL to be known before the service is fully configured. Use a temporary placeholder callback URL for the first deployment if necessary, then update the Secret Manager value and redeploy with the final Cloud Run URL. Do not treat `/readyz` as ready until the database and OIDC identity dependencies are configured.

## CI/CD ownership

- **Frontend:** Cloudflare Workers Builds deploys from `main`.
- **GitHub Actions CI:** frontend tests/build, Go tests/build, Docker image build validation, and OpenAPI validation.
- **Backend deployment:** deferred; no GitHub Actions backend deployment workflow is active.
- **Contracts:** validate OpenAPI and keep the checked frontend client aligned.

The CI pipeline validates build and test quality only. It must not require production cloud credentials or perform backend deployment until deployment is explicitly resumed.
