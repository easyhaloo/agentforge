import { Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import type { AccountContext, OrganizationSummary } from "../shared/api/identity";
import { CURRENT_ORGANIZATION_HANDLE, findOrganizationByHandle, organizationHandle, withOrganizationHandle } from "../shared/routing";
import { Button } from "../shared/ui";
import { useAppAccount } from "./account-context";

/** What the gate hands to the page routes below it (read with `useOutletContext`). */
export type OrganizationOutletContext = { organization: OrganizationSummary; account: AccountContext };

const copy = {
  organization: {
    signedOutTitle: "Sign in to manage your organization",
    signedOutBody: "Organization settings require an authenticated AgentForge session.",
    retryWhenSignedOut: true,
    unavailableTitle: "Organization service unavailable",
    noOrganization: "This account has no active organization membership. Ask an organization owner for an invitation.",
  },
  pipelines: {
    signedOutTitle: "Sign in to view pipelines", signedOutBody: "Workflows belong to your organization.",
    retryWhenSignedOut: true, unavailableTitle: "Pipeline service unavailable",
    noOrganization: "This account has no active organization membership.",
  },
  changesets: {
    signedOutTitle: "Sign in to view changesets",
    signedOutBody: "Changesets are scoped to an authenticated organization.",
    retryWhenSignedOut: false,
    unavailableTitle: "Changeset service unavailable",
    noOrganization: "This account has no active organization membership.",
  },
  repositories: {
    signedOutTitle: "Sign in to view repositories",
    signedOutBody: "Repositories are scoped to an authenticated organization.",
    retryWhenSignedOut: false,
    unavailableTitle: "Repository service unavailable",
    noOrganization: "This account has no active organization membership.",
  },
} as const;

/**
 * Guards the pages under `/orgs/:org`: shows the loading, signed-out, unavailable and no-organization
 * states, resolves the `:org` handle, and only then renders the page. The `current` alias is replaced by
 * the selected organization's own handle (history `replace`) once the account is known.
 */
export function OrganizationGate({ variant }: { variant: keyof typeof copy }) {
  const { account, accountState, accountError, reload, selectedOrganization } = useAppAccount();
  const { org: handle = "" } = useParams();
  const location = useLocation();
  const text = copy[variant];

  if (accountState === "loading") return <section className="card org-auth-state">Loading authenticated account and organizations…</section>;
  if (accountState === "signed-out") return (
    <section className="card org-auth-state">
      <h2>{text.signedOutTitle}</h2>
      <p>{text.signedOutBody}</p>
      <a className="button primary" href="/auth/oidc/login">Continue with SSO</a>
      {text.retryWhenSignedOut && <Button className="button secondary" onClick={() => void reload()}>Retry</Button>}
    </section>
  );
  if (accountState === "unavailable") return (
    <section className="card org-auth-state">
      <h2>{text.unavailableTitle}</h2>
      <p>{accountError}</p>
      <Button className="button secondary" onClick={() => void reload()}>Retry</Button>
    </section>
  );

  if (handle === CURRENT_ORGANIZATION_HANDLE && selectedOrganization) {
    return <Navigate replace to={{ pathname: withOrganizationHandle(location.pathname, organizationHandle(selectedOrganization)), search: location.search, hash: location.hash }} />;
  }
  const organization = account ? findOrganizationByHandle(account.organizations, handle) : undefined;
  if (account && organization) {
    const context: OrganizationOutletContext = { organization, account };
    return <Outlet context={context} />;
  }
  return (
    <section className="card org-auth-state">
      <h2>No active organization</h2>
      <p>{handle === CURRENT_ORGANIZATION_HANDLE ? text.noOrganization : `No organization "${handle}" is available to this account.`}</p>
    </section>
  );
}
