# Identity and Organization Isolation

**Status:** Architecture decision; implementation is intentionally gated.  
**Scope:** Go API identity, organization membership, tenant isolation, and the security boundary for delivery resources.

## Goals

- Establish one stable authenticated principal for every protected request.
- Make organization membership, not possession of an organization identifier, the basis for access.
- Ensure every persisted delivery resource belongs to exactly one organization.
- Enforce tenant scope in repository queries, not only in HTTP handlers.
- Fail closed when identity, membership, or authorization dependencies are unavailable.
- Keep the identity provider replaceable through standard OpenID Connect (OIDC).

## Decisions

### 1. Authentication: OIDC Authorization Code Flow

The Go API is the OIDC relying party and owns the callback/session boundary.

- Use Authorization Code Flow with PKCE, state, and nonce.
- Discover issuer metadata and validate issuer, signature, audience, nonce, and token time claims.
- Identify an external identity by the immutable pair (issuer, subject). Email is profile data, never a primary key or authorization key.
- Create or update the local user profile only after successful OIDC validation.
- Issue an opaque, random application session identifier in a Secure, HttpOnly, SameSite=Lax, host-only cookie. Persist only a SHA-256 hash of the session token and CSRF token; store expiry and revocation state in PostgreSQL.
- Require CSRF protection for cookie-authenticated state-changing requests. Validate Origin against the exact configured `APP_ORIGIN` and bind the CSRF token hash to the active session.
- Do not accept actor IDs, user IDs, roles, or organization IDs as authoritative request-body fields.
- Do not enable a development identity shortcut in production.

Configuration is explicit and all-or-nothing: OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URL, optional SESSION_TTL, and APP_ORIGIN. The API uses fixed host-only `__Host-agentforge_session` and `__Host-agentforge_csrf` cookie names. Missing or invalid configuration, or failed provider discovery, leaves protected routes unavailable. Non-loopback issuer, callback, and application origins must use HTTPS.

### 2. Principal and organization selection

The authenticated principal contains a local user_id and the verified external identity reference. Organization selection is explicit in the resource route:

/api/v1/organizations/{organization_id}/changesets

The path organization ID is an untrusted selector. It becomes an authorized scope only after the server verifies an active membership for the authenticated user. A guessed, copied, or modified organization ID must never grant access.

The API resolves a request context in this order:

1. Validate the application session and load the local user.
2. Parse the requested organization ID.
3. Load the user's active membership in that organization.
4. Authorize the operation against the membership role and resource policy.
5. Pass the resolved organization ID to every repository operation.

No query may fall back to a global/unscoped lookup.

### 3. Organization and membership model

- organizations: tenant boundary, immutable ID, display name, lifecycle state, timestamps.
- users: local user identity and profile.
- external_identities: unique (issuer, subject) mapping to one local user.
- organization_memberships: unique (organization_id, user_id), role, state, inviter and timestamps.
- sessions: hashed opaque token, user ID, expiry, revocation and creation timestamps.

Initial roles:

| Role | Read | Create changeset | Manage members/settings | Administrative policy |
| --- | --- | --- | --- | --- |
| Owner | Yes | Yes | Yes | Yes |
| Admin | Yes | Yes | Yes | Yes |
| Member | Yes | Yes | No | No |
| Viewer | Yes | No | No | No |

Role checks are centralized in an authorization service. Resource-specific ownership or reviewer rules remain additional constraints; organization membership does not bypass them.

Organization creation and first-owner assignment require a deliberate bootstrap path (operator-provisioned invitation or one-time deployment bootstrap). The first arbitrary OIDC login must not silently create a privileged tenant.

### 4. Tenant-scoped persistence

Every organization-owned table carries a non-null organization_id foreign key. Delivery changesets are uniquely identified within an organization, not globally.

Repository contracts must require organization scope:

- Create(ctx, organizationID, changeset)
- Update(ctx, organizationID, changeset, expectedVersion)
- Get(ctx, organizationID, changesetID)
- List(ctx, organizationID, limit, offset)

All SQL statements include organization_id in predicates and inserts. Updates use both organization ID and expected version. A record outside the active organization is indistinguishable from a missing record at the HTTP boundary (404), preventing cross-tenant enumeration.

Database row-level security may be added as defense in depth, but it does not replace explicit scoped repository APIs and authorization checks.

### 5. HTTP and browser security

- Protected endpoints return 401 when there is no valid session and 403 when membership exists but the role is insufficient.
- Missing identity/session/membership infrastructure returns 503; it never falls back to a demo actor.
- CORS uses an exact configured origin allowlist. Wildcard origins are forbidden with credentials.
- Cookie-authenticated writes require CSRF validation.
- Security-sensitive events (login, logout, membership changes, denied access, and privileged operations) are auditable without logging credentials, session tokens, or OIDC tokens.
- Readiness checks include PostgreSQL and the configured identity/session dependencies.

## Delivery lifecycle integration

The organization ID is part of the persistence identity for a Changeset. Revision, Evaluation, Evidence, Review, Merge, and Audit records inherit the Changeset's organization boundary and remain bound to their exact Revision.

The existing server-side merge preflight remains mandatory: current revision, current verified evidence, approved review, role authorization, and provider-side branch state are rechecked immediately before merge.

## Rollout gates

The current Changeset API must remain fail-closed until all of the following are implemented and tested:

1. OIDC callback, state/nonce/PKCE validation, session persistence, logout and revocation.
2. Local user and external identity persistence.
3. Organization and membership lifecycle with a safe first-owner bootstrap, administrative APIs, and invitation lifecycle.
4. Centralized role authorization and request principal context.
5. Tenant-scoped schema migration and tenant-scoped repository methods.
6. HTTP routes moved under the organization scope; no legacy unscoped protected route remains.
7. Tests proving user A cannot read, update, list, or infer user B's organization resources.
8. Exact-origin CORS and CSRF protections for browser sessions.

Until these gates pass, the UI must continue to present authentication as unavailable and must not claim that Changeset creation is operational.

## Implementation status

The Go API now includes the OIDC Authorization Code + PKCE login/callback/logout flow, provider discovery/JWKS verification, one-time state/nonce storage, hashed application sessions, exact-origin CORS/CSRF, and a database-backed principal resolver. The operator-only `cmd/bootstrap-owner` command can provision the first owner for an organization using the exact OIDC issuer and immutable subject. The OIDC callback now checks for at least one active membership in an active organization before creating a browser session; an authenticated but unprovisioned identity receives 403 and cannot obtain an application session.

Organization member administration now includes tenant-scoped member listing, role/status updates, soft removal, and transactional audit attribution. Owners can manage all membership roles; administrators can manage only members/viewers and cannot grant administrative privileges. Mutations serialize on an organization-scoped advisory lock, re-check the actor's active administrative membership in the transaction, and prevent demotion, suspension, or removal of the last active owner. Invitation creation/acceptance and a read API for the audit trail remain pending. Until those workflows are implemented and the production OIDC provider is configured, production readiness must not be treated as proof that an organization has been provisioned.
