import { Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { AccountContext, OrganizationSummary } from "../shared/api/identity";
import { CURRENT_ORGANIZATION_HANDLE, findOrganizationByHandle, organizationHandle, withOrganizationHandle } from "../shared/routing";
import { Button } from "../shared/ui";
import { LoginRedirect } from "./LoginRedirect";
import { useAppAccount } from "./account-context";

/** What the gate hands to the page routes below it (read with `useOutletContext`). */
export type OrganizationOutletContext = { organization: OrganizationSummary; account: AccountContext };

/**
 * The translation keys of each gate variant.
 *
 * The keys are written out rather than built from the variant name, so the translation check can
 * see every one of them.
 */
const copy = {
  organization: {
    unavailableTitle: "app:organizationGate.organization.unavailableTitle",
    noOrganization: "app:organizationGate.organization.noOrganization",
  },
  pipelines: {
    unavailableTitle: "app:organizationGate.pipelines.unavailableTitle",
    noOrganization: "app:organizationGate.pipelines.noOrganization",
  },
  changesets: {
    unavailableTitle: "app:organizationGate.changesets.unavailableTitle",
    noOrganization: "app:organizationGate.changesets.noOrganization",
  },
  repositories: {
    unavailableTitle: "app:organizationGate.repositories.unavailableTitle",
    noOrganization: "app:organizationGate.repositories.noOrganization",
  },
} as const;

/**
 * Guards the pages under `/orgs/:org`: shows the loading, signed-out, unavailable and no-organization
 * states, resolves the `:org` handle, and only then renders the page. The `current` alias is replaced by
 * the selected organization's own handle (history `replace`) once the account is known.
 */
export function OrganizationGate({ variant }: { variant: keyof typeof copy }) {
  const { t } = useTranslation("app");
  const { account, accountState, accountError, reload, selectedOrganization } = useAppAccount();
  const { org: handle = "" } = useParams();
  const location = useLocation();
  const text = copy[variant];

  if (accountState === "loading") return <section className="card org-auth-state">{t("app:organizationGate.loading")}</section>;
  if (accountState === "signed-out") return <LoginRedirect />;
  if (accountState === "unavailable") return (
    <section className="card org-auth-state">
      <h2>{t(text.unavailableTitle)}</h2>
      <p>{accountError}</p>
      <Button className="button secondary" onClick={() => void reload()}>{t("app:organizationGate.retry")}</Button>
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
      <h2>{t("app:organizationGate.noOrganization")}</h2>
      <p>{handle === CURRENT_ORGANIZATION_HANDLE ? t(text.noOrganization) : t("app:organizationGate.noOrganizationHandle", { handle })}</p>
    </section>
  );
}
