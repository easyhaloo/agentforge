# Cloudflare Pages deployment

AgentForge is deployed as a static Vite application on Cloudflare Pages.

## Production settings

| Setting | Value |
| --- | --- |
| Cloudflare Pages project | `agentforge` |
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js | `22` |
| Public URL | `https://agentforge.pages.dev` |

Cloudflare Pages serves the SPA entry point for unknown paths when the output does not contain a top-level `404.html`. Do not add a top-level `404.html` unless intentionally replacing this behavior.

## One-time Cloudflare setup

1. Create or sign in to a Cloudflare account.
2. Open **Workers & Pages** and create a Pages project named **agentforge**.
3. Choose **Direct Upload** / **Create using Direct Upload**. The project is deployed by GitHub Actions, not by Cloudflare's Git integration.
4. Set the production branch to `main`.
5. In Cloudflare, create an API token with the **Account / Cloudflare Pages / Edit** permission, scoped to the account that owns the Pages project.
6. In the GitHub repository, open **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `CLOUDFLARE_API_TOKEN`: the API token value.
   - `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID.

Do not commit either value to the repository or put them in frontend environment variables.

## Continuous deployment

The workflow at `.github/workflows/deploy.yml` runs on pushes to `main` and manual dispatches.

It installs dependencies, runs the Vitest suite, builds the Vite app, and deploys `dist/` to the production Pages project. Deployment is skipped for manual runs from branches other than `main`.

Pull requests continue to run the repository CI workflow. This production workflow deliberately does not deploy pull-request code, avoiding exposure of deployment credentials to untrusted fork workflows.

## First deployment checklist

- [ ] Create the Cloudflare Pages project named `agentforge`.
- [ ] Add `CLOUDFLARE_API_TOKEN` to GitHub Actions secrets.
- [ ] Add `CLOUDFLARE_ACCOUNT_ID` to GitHub Actions secrets.
- [ ] Run **Actions → Deploy to Cloudflare Pages → Run workflow** on `main`, or push a commit to `main`.
- [ ] Confirm the workflow succeeds and open [https://agentforge.pages.dev](https://agentforge.pages.dev).

## Troubleshooting

- **Project not found:** confirm the Pages project is named exactly `agentforge` and exists in the account identified by `CLOUDFLARE_ACCOUNT_ID`.
- **Authentication / permission error:** verify the token has Account-level **Cloudflare Pages: Edit** permission and is scoped to the correct account.
- **Build failure:** inspect the install, test, and build steps before investigating Cloudflare deployment.
- **Deep link returns 404:** confirm there is no top-level `404.html` in the deployed `dist/` directory; Pages uses SPA fallback when that file is absent.
