# AgentForge Deployment Architecture

## Frontend deployment

The current Cloudflare project is a **Cloudflare Worker** serving the React/Vite build output as Worker Static Assets. Cloudflare Workers Builds owns production deployment through direct Git integration.

- Worker name: `agentforge`
- Production URL: `https://agentforge.gangshusheng.workers.dev`
- Build command: `npm run build`
- Build output: `apps/web/dist/`
- Production branch: `main`

Cloudflare Workers Builds is the sole frontend deployment owner. Do not add a second GitHub Actions Wrangler deployment or use `wrangler pages deploy`.

## Backend deployment

The Go API is deployed independently to **Google Cloud Run** as a container built from `backend/api/Dockerfile`.

- Cloud Run service: `agentforge-api`
- Container port: `8080`
- Health endpoint: `GET /healthz`
- Readiness endpoint: `GET /readyz`
- Database: Supabase PostgreSQL, using its connection pooler where appropriate
- Schema migrations: embedded SQL migrations are applied by the API during startup under a PostgreSQL advisory transaction lock
- Runtime secrets: Google Secret Manager; never put credentials in GitHub variables, source files, or frontend build configuration

The container runs as the non-root user in a distroless runtime image. Cloud Run starts with zero minimum instances and a maximum of three instances by default. This is a low-cost development/early-production baseline, not an availability guarantee.

### Required Google Cloud setup

Create or configure the following resources before enabling the deployment workflow:

1. A Google Cloud project with billing enabled and the Cloud Run, Cloud Build, Artifact Registry, IAM Credentials, and Secret Manager APIs enabled.
2. An Artifact Registry Docker repository in the selected region (default workflow variable: `GCP_ARTIFACT_REPOSITORY`).
3. A GitHub Workload Identity Federation provider and a deployer service account. Restrict the provider attribute condition to this repository and the intended GitHub branch/environment.
4. Grant the deployer service account permission to build with Cloud Build, write to the Artifact Registry repository, deploy Cloud Run services, and act as the Cloud Run runtime service account.
5. Grant the Cloud Run runtime service account `Secret Manager Secret Accessor` on the five secrets below.
6. Create these Secret Manager secrets and add their values:
   - `AGENTFORGE_DATABASE_URL`: Supabase PostgreSQL pooler connection string with TLS enabled.
   - `AGENTFORGE_OIDC_ISSUER_URL`
   - `AGENTFORGE_OIDC_CLIENT_ID`
   - `AGENTFORGE_OIDC_CLIENT_SECRET`
   - `AGENTFORGE_OIDC_REDIRECT_URL`: the public Cloud Run URL plus `/auth/oidc/callback`.
7. Configure the OIDC provider's allowed callback URL to exactly match `AGENTFORGE_OIDC_REDIRECT_URL`.

The workflow expects these GitHub Actions secrets:

| Secret | Purpose |
| --- | --- |
| `GCP_PROJECT_ID` | Google Cloud project ID |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full Workload Identity Provider resource name |
| `GCP_SERVICE_ACCOUNT` | Deployer service account email |

And these GitHub Actions variables:

| Variable | Purpose |
| --- | --- |
| `GCP_REGION` | Cloud Run and Artifact Registry region |
| `GCP_ARTIFACT_REPOSITORY` | Existing Artifact Registry Docker repository |
| `FRONTEND_ORIGIN` | Exact HTTPS origin of the deployed frontend |

The initial deployment requires the OIDC callback URL to be known before the service is fully configured. Use a temporary placeholder callback URL for the first deployment if necessary, then update the Secret Manager value and redeploy with the final Cloud Run URL. Do not treat `/readyz` as ready until the database and OIDC identity dependencies are configured.

### Deployment workflow

`.github/workflows/deploy-backend.yml` builds and publishes the container with Cloud Build, deploys it to Cloud Run, and checks `/healthz`. It runs on pushes to `main` that change `backend/api/**`, and can also be started manually. It fails early when required GitHub configuration is missing.

The API currently applies embedded SQL migrations at startup. Keep migrations backward-compatible with the previous deployed application version because Cloud Run can briefly run old and new instances during rollout.

## CI/CD ownership

- **Frontend:** Cloudflare Workers Builds deploys from `main`.
- **GitHub Actions CI:** frontend tests/build, Go tests/build, Docker image build validation, and OpenAPI validation.
- **Backend deployment:** GitHub Actions + Workload Identity Federation + Cloud Build + Cloud Run.
- **Contracts:** validate OpenAPI and keep the checked frontend client aligned.

Never commit credentials or expose backend secrets through frontend build variables.
