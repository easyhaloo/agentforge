import { useEffect } from "react";
import { Link, useLocation, useOutletContext, useParams, useRouteError } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DeliveryFlow } from "../features/delivery";
import { ChangesetDetailPage } from "../pages/changesets/ChangesetDetailPage";
import { ChangesetsPage } from "../pages/changesets/ChangesetsPage";
import { OrganizationManagementPage } from "../pages/organization/OrganizationManagementPage";
import { OverviewPage } from "../pages/overview";
import { PipelinesPage } from "../pages/pipelines/PipelinesPage";
import { RepositoriesPage } from "../pages/repositories/RepositoriesPage";
import { WebIDEPage } from "../pages/webide/WebIDEPage";
import { ResourceWorkspacePage } from "../pages/resources";
import { SettingsLayout } from "../pages/settings/SettingsLayout";
import { flatPaths, type ChangesetTab } from "../shared/routing";
import type { OrganizationOutletContext } from "./OrganizationGate";
import { useNotify } from "./useNotify";
import { LoginPage } from "../pages/login";
import { RegisterPage } from "../pages/register/RegisterPage";

// Thin adapters between the route table and the pages: they supply what a page needs from the
// shell (notifications, the organization resolved by the gate) so the pages keep their props.

export function LoginRoute() {
  return <LoginPage />;
}

export function RegisterRoute() {
  return <RegisterPage />;
}

export function SettingsRoute() {
  const notify = useNotify();
  // TODO: Get actual user data from context or API
  // For now, using placeholder values until user context is available
  return (
    <SettingsLayout
      username="user"
      displayName="User"
      onNotify={notify}
    />
  );
}

export function OverviewRoute() {
  const notify = useNotify();
  return <OverviewPage onNotify={notify} created={[]} />;
}

export function ResourceRoute({ label }: { label: string }) {
  const notify = useNotify();
  // The key keeps each page's state and its agentforge:resources:<label> storage separate.
  return <ResourceWorkspacePage key={label} page={label} onNotify={notify} />;
}

export function DeliveryRoute({ label }: { label: string }) {
  const notify = useNotify();
  return <DeliveryFlow page={label} onNotify={notify} />;
}

export function ChangesetsRoute() {
  const { organization } = useOutletContext<OrganizationOutletContext>();
  const notify = useNotify();
  return <ChangesetsPage key={organization.id} organization={organization} onNotify={notify} />;
}

export function ChangesetDetailRoute({ tab }: { tab: ChangesetTab }) {
  const { organization, account } = useOutletContext<OrganizationOutletContext>();
  const { id = "" } = useParams();
  const notify = useNotify();
  return <ChangesetDetailPage key={`${organization.id}:${id}:${tab}`} organization={organization} accountUserID={account.user_id} changesetID={id} tab={tab} onNotify={notify} />;
}

export function PipelinesRoute() {
  const { organization } = useOutletContext<OrganizationOutletContext>();
  return <PipelinesPage key={organization.id} organization={organization} />;
}

export function RepositoriesRoute() {
  const { organization } = useOutletContext<OrganizationOutletContext>();
  const notify = useNotify();
  return <RepositoriesPage key={organization.id} organization={organization} onNotify={notify} />;
}

export function WebIDERoute() {
  const { organization } = useOutletContext<OrganizationOutletContext>();
  return <WebIDEPage key={organization.id} organization={organization} />;
}

export function OrganizationRoute() {
  const { organization } = useOutletContext<OrganizationOutletContext>();
  const notify = useNotify();
  return <OrganizationManagementPage key={organization.id} organization={organization} onNotify={notify} />;
}

export function NotFound() {
  const { pathname } = useLocation();
  const { t } = useTranslation("app");
  return (
    <section className="card org-auth-state">
      <p>{t("app:notFound.title", { pathname })}</p>
      <Link className="button primary" to={flatPaths.overview}>{t("app:notFound.goToOverview")}</Link>
    </section>
  );
}

// Route errors are logged for developers and never shown: the message and stack of an Error are internal details.
function useLogRouteError() {
  const error = useRouteError();
  useEffect(() => { console.error("AgentForge route error", error); }, [error]);
}

/** Replaces only the page area when a page fails, so the sidebar and topbar stay usable. */
export function PageError() {
  useLogRouteError();
  const { t } = useTranslation("app");
  return (
    <section className="card org-auth-state" role="alert">
      <h2>{t("app:pageError.title")}</h2>
      <p>{t("app:pageError.description")}</p>
      <Link className="button primary" to={flatPaths.overview}>{t("app:pageError.goToOverview")}</Link>
    </section>
  );
}

/** Last resort for errors thrown by the root layout itself, when there is no shell to keep. */
export function RootError() {
  useLogRouteError();
  const { t } = useTranslation("app");
  return (
    <div className="content">
      <section className="card org-auth-state" role="alert">
        <h2>{t("app:rootError.title")}</h2>
        <p>{t("app:rootError.description")}</p>
        <a className="button primary" href="/">{t("app:rootError.reload")}</a>
      </section>
    </div>
  );
}
