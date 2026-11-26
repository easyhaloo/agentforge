# Production OIDC Configuration

This directory contains example configurations for deploying AgentForge with production OIDC providers.

## Required Environment Variables

All OIDC configurations require these core variables:

```bash
# Application
export PORT=8080
export DATABASE_URL='postgresql://user:pass@host:5432/agentforge?sslmode=require'
export APP_ORIGIN='https://agentforge.example.com'

# OIDC Provider
export OIDC_ISSUER_URL='<provider-specific>'
export OIDC_CLIENT_ID='<your-client-id>'
export OIDC_CLIENT_SECRET='<your-client-secret>'
export OIDC_REDIRECT_URL='https://agentforge.example.com/auth/oidc/callback'

# Session
export SESSION_TTL='12h'  # Optional, default 12h, range: 5m-168h

# Git and Evidence (optional for delivery features)
export GIT_REPOSITORY_ROOT='/var/lib/agentforge/git'
export EVIDENCE_ROOT='/var/lib/agentforge/evidence'

# Email Provider (optional for invitation emails)
export EMAIL_PROVIDER='sendgrid'  # or 'ses'
export EMAIL_FROM='noreply@agentforge.example.com'

# SendGrid (if EMAIL_PROVIDER=sendgrid)
export SENDGRID_API_KEY='<your-sendgrid-api-key>'

# AWS SES (if EMAIL_PROVIDER=ses)
export AWS_SES_REGION='us-east-1'
export AWS_ACCESS_KEY_ID='<your-aws-access-key>'      # Optional if using IAM role
export AWS_SECRET_ACCESS_KEY='<your-aws-secret-key>'  # Optional if using IAM role
```

## Provider-Specific Configuration

### Google Workspace / Google Identity

```bash
export OIDC_ISSUER_URL='https://accounts.google.com'
export OIDC_CLIENT_ID='<your-client-id>.apps.googleusercontent.com'
export OIDC_CLIENT_SECRET='<your-client-secret>'
export OIDC_REDIRECT_URL='https://agentforge.example.com/auth/oidc/callback'
```

**Setup:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new OAuth 2.0 Client ID (Web application)
3. Add authorized redirect URI: `https://agentforge.example.com/auth/oidc/callback`
4. Copy Client ID and Client Secret

**Scopes:** `openid profile email` (requested automatically by the API)

### Okta

```bash
export OIDC_ISSUER_URL='https://<your-domain>.okta.com'
export OIDC_CLIENT_ID='<your-client-id>'
export OIDC_CLIENT_SECRET='<your-client-secret>'
export OIDC_REDIRECT_URL='https://agentforge.example.com/auth/oidc/callback'
```

**Setup:**
1. Go to Okta Admin Console → Applications → Create App Integration
2. Select "OIDC - OpenID Connect" and "Web Application"
3. Add Sign-in redirect URI: `https://agentforge.example.com/auth/oidc/callback`
4. Grant type: Authorization Code
5. Copy Client ID and Client Secret

**Note:** Use your Okta domain's issuer URL, typically `https://<your-domain>.okta.com` or `https://<your-domain>.oktapreview.com`.

### Auth0

```bash
export OIDC_ISSUER_URL='https://<your-tenant>.auth0.com/'
export OIDC_CLIENT_ID='<your-client-id>'
export OIDC_CLIENT_SECRET='<your-client-secret>'
export OIDC_REDIRECT_URL='https://agentforge.example.com/auth/oidc/callback'
```

**Setup:**
1. Go to Auth0 Dashboard → Applications → Create Application
2. Select "Regular Web Application"
3. Add Allowed Callback URL: `https://agentforge.example.com/auth/oidc/callback`
4. Copy Client ID and Client Secret

**Note:** The issuer URL must end with a trailing slash.

### Microsoft Entra ID (Azure AD)

```bash
export OIDC_ISSUER_URL='https://login.microsoftonline.com/<tenant-id>/v2.0'
export OIDC_CLIENT_ID='<your-application-id>'
export OIDC_CLIENT_SECRET='<your-client-secret>'
export OIDC_REDIRECT_URL='https://agentforge.example.com/auth/oidc/callback'
```

**Setup:**
1. Go to Azure Portal → Azure Active Directory → App Registrations → New Registration
2. Add Redirect URI (Web): `https://agentforge.example.com/auth/oidc/callback`
3. Create a new client secret under Certificates & Secrets
4. Copy Application (client) ID and Client Secret
5. Replace `<tenant-id>` with your Azure AD tenant ID

**Alternative (multi-tenant):**
```bash
export OIDC_ISSUER_URL='https://login.microsoftonline.com/common/v2.0'
```

### GitLab

```bash
export OIDC_ISSUER_URL='https://gitlab.com'
export OIDC_CLIENT_ID='<your-application-id>'
export OIDC_CLIENT_SECRET='<your-application-secret>'
export OIDC_REDIRECT_URL='https://agentforge.example.com/auth/oidc/callback'
```

**Setup:**
1. Go to GitLab → User Settings → Applications
2. Add redirect URI: `https://agentforge.example.com/auth/oidc/callback`
3. Scopes: `openid profile email`
4. Copy Application ID and Secret

**Self-hosted GitLab:**
```bash
export OIDC_ISSUER_URL='https://gitlab.example.com'
```

## Security Considerations

### HTTPS Requirement

AgentForge requires HTTPS for all non-loopback origins. The `APP_ORIGIN` must be:
- `https://` for production domains
- `http://localhost:*` or `http://127.0.0.1:*` for local development only

### Session Security

- Session and CSRF tokens are 256-bit cryptographically random values
- Only SHA-256 hashes are stored in the database
- Session cookies use `__Host-` prefix, `Secure`, `HttpOnly`, and `SameSite=Lax`
- CSRF cookies are readable by JavaScript (required for `X-CSRF-Token` header)
- Sessions expire after `SESSION_TTL` (default 12 hours)

### OIDC Security

- Authorization Code flow with PKCE (S256)
- State and nonce are cryptographically random and verified
- ID token signature is validated using provider's JWKS
- Issuer, audience, and time claims are validated
- One-time state/nonce hashes prevent replay attacks

### Database Connection

Production `DATABASE_URL` should:
- Use `sslmode=require` or `sslmode=verify-full`
- Connect to a private network endpoint
- Use strong, unique credentials
- Enable connection pooling via pgBouncer for high-traffic deployments

## Readiness Checks

The API reports readiness status:

```bash
curl https://agentforge.example.com/readyz
```

Readiness requirements:
- PostgreSQL connection succeeds
- OIDC discovery metadata is available
- OIDC JWKS can be fetched
- `APP_ORIGIN` is valid (HTTPS for production)

The API returns `503 Service Unavailable` until all dependencies are ready.

## Organization Lifecycle Variables

| Variable | Default | Description |
|---|---|---|
| `PLATFORM_ADMIN_SUBJECTS` | *(empty)* | Comma-separated `issuer\|subject` pairs allowed to call `/api/v1/admin/identity`. Empty disables the endpoint. |
| `ORG_SELF_SERVICE_CREATE` | `false` | When `true`, any signed-in user can create an organization (`POST /api/v1/organizations`). Keep `false` unless the product explicitly opts in. |
| `ORG_DELETION_GRACE` | `720h` | How long a scheduled deletion can be cancelled, and how long retired organization slugs redirect (30 days by default). |

Behavior to be aware of after deploying migration 063:

- Suspending an organization (`POST /api/v1/organizations/{org}/suspend`, Owner only) makes every
  organization-scoped write return `423 Locked`, including Git pushes (`git-receive-pack`).
  Clones, fetches and reads keep working. The whitelist covers only resume and deletion cancellation.
- Deletion requires suspension first and can be cancelled for `ORG_DELETION_GRACE`. After the grace
  window the organization is marked `deleted_at`; **data purge is not implemented in this version**
  and must be performed manually (audit events are always kept).
- Retired organization slugs redirect for the grace window and cannot be claimed by other
  organizations meanwhile.

## Platform Operator Identity and Verification Steps

1. Add the operator's external identity to `PLATFORM_ADMIN_SUBJECTS`, for example
   `PLATFORM_ADMIN_SUBJECTS=https://accounts.google.com|1147-abc-def`.
2. After signing in through that provider, open `/admin/identity`. The page shows the effective
   provider configuration (secrets as configured/unconfigured booleans only), the readiness checks
   with their durations and raw errors, and a "re-check" action. The same probe code backs `/readyz`.
3. Acceptance checklist for the identity provider page after go-live:
   - [ ] `GET /api/v1/admin/identity` returns 200 for operators and 404 for everyone else.
   - [ ] No response body contains a secret value — only `secret_configured` booleans.
   - [ ] The checks list shows discovery, JWKS, callback URL, client secret, and email provider rows.
   - [ ] `POST /api/v1/admin/identity/check` refreshes the list without a redeploy.

## First Owner Bootstrap

After deploying with OIDC configured, provision the first organization owner:

```bash
# On a trusted operator machine with database access
export DATABASE_URL='<production-database-url>'
export BOOTSTRAP_OIDC_ISSUER='https://accounts.google.com'
export BOOTSTRAP_OIDC_SUBJECT='<user-sub-claim>'
export BOOTSTRAP_ORGANIZATION_ID='your-org-id'
export BOOTSTRAP_ORGANIZATION_NAME='Your Organization'
export BOOTSTRAP_ORGANIZATION_SLUG='your-org'  # Optional

go run ./cmd/bootstrap-owner
```

The `BOOTSTRAP_OIDC_SUBJECT` must match the exact `sub` claim from the provider's ID token. For Google, this is a numeric string. For Okta/Auth0, it's typically a UUID or email-prefixed identifier.

## Deployment Checklist

- [ ] Configure production PostgreSQL with SSL
- [ ] Set up OIDC application with production callback URL
- [ ] Configure all required environment variables
- [ ] Deploy API with HTTPS-enabled ingress
- [ ] Verify `/readyz` returns 200
- [ ] Bootstrap first organization owner
- [ ] Test OIDC login flow end-to-end
- [ ] Configure email provider for invitation delivery
- [ ] Set up monitoring and alerting
- [ ] Configure backup and disaster recovery

## Troubleshooting

### OIDC Discovery Fails

Check that `OIDC_ISSUER_URL` is correct and accessible:

```bash
curl $OIDC_ISSUER_URL/.well-known/openid-configuration
```

### Session Not Created After Login

Check logs for:
- ID token validation errors (signature, issuer, audience, expiry)
- Missing or inactive organization membership
- Invalid invitation token

### CORS Errors

Ensure `APP_ORIGIN` exactly matches the frontend origin (including protocol and port, no trailing slash).

### Database Connection Issues

Verify `DATABASE_URL` with:

```bash
psql "$DATABASE_URL" -c "SELECT 1"
```

## Example Kubernetes Deployment

See [`kubernetes-deployment.yaml`](./kubernetes-deployment.yaml) for a complete production deployment example with:
- OIDC environment variables from Kubernetes secrets
- Database credentials from secrets
- TLS ingress configuration
- Health checks and readiness probes
