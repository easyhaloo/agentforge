import { useEffect } from "react";
import { Link, useLocation, useOutletContext, useParams, useRouteError } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DeliveryFlow } from "../features/delivery";
import { ChangesetDetailPage } from "../pages/changesets/ChangesetDetailPage";
import { ChangesetsPage } from "../pages/changesets/ChangesetsPage";
import { OrganizationManagementPage } from "../pages/organization/OrganizationManagementPage";
import { OverviewPage, OverviewUnavailable } from "../pages/overview";
import { PipelineRunPage } from "../pages/pipelines/PipelineRunPage";
import { PipelineEditorPage, PipelinesPage } from "../pages/pipelines/PipelinesPage";
import { RepositoriesPage } from "../pages/repositories/RepositoriesPage";
import { RepositoryDetailPage } from "../pages/repositories/RepositoryDetailPage";
import { WebIDEPage } from "../pages/webide/WebIDEPage";
import { WorkspaceEditorPage } from "../pages/webide/WorkspaceEditorPage";
import { ResourceWorkspacePage } from "../pages/resources";
import { SettingsLayout } from "../pages/settings/SettingsLayout";
import { Button, Loading } from "../shared/ui";
import { flatPaths, type ChangesetTab } from "../shared/routing";
import type { OrganizationOutletContext } from "./OrganizationGate";
import { PageHeader } from "./components/PageHeader";
import { useAppAccount } from "./account-context";
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
  const { account, updateDisplayName } = useAppAccount();
  if (!account) return null;
  return <SettingsLayout organizations={account.organizations} notify={notify} updateDisplayName={updateDisplayName} />;
}

export function OverviewRoute() {
  const { account, accountState, selectedOrganization, reload } = useAppAccount();
  const { t } = useTranslation("overview");
  if (accountState === "loading") return <OverviewUnavailable title={t("workbench.loading")}><Loading /></OverviewUnavailable>;
  if (accountState === "signed-out") return <OverviewUnavailable title={t("workbench.signIn")}>
    <Link className="button primary" to="/login">{t("login:signInButton")}</Link>
  </OverviewUnavailable>;
  if (accountState === "unavailable") return <OverviewUnavailable title={t("app:errors.accountLoadFailed")}>
    <Button onClick={() => void reload()}>{t("app:organizationGate.retry")}</Button>
  </OverviewUnavailable>;
  if (!selectedOrganization || !account) return <OverviewUnavailable title={t("app:organizationGate.noOrganization")} />;
  return <OverviewPage key={selectedOrganization.id} organization={selectedOrganization}
    userId={account.user_id} displayName={account.display_name || account.email || ""} />;
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
  return <PipelinesPage key={organization.id} organization={organization} renderHeader={actions =>
    <PageHeader label="CI / CD" descriptionKey="navigation:descriptions.cicd" {...actions} />} />;
}

export function PipelineEditorRoute() {
  const { organization } = useOutletContext<OrganizationOutletContext>();
  const { id = "" } = useParams();
  return <PipelineEditorPage key={`${organization.id}:${id}`} organization={organization} id={id} />;
}

export function PipelineRunRoute() {
  const { organization } = useOutletContext<OrganizationOutletContext>();
  const { runId = "" } = useParams();
  return <PipelineRunPage key={`${organization.id}:${runId}`} organization={organization} runId={runId} />;
}

export function RepositoriesRoute() {
  const { organization } = useOutletContext<OrganizationOutletContext>();
  const notify = useNotify();
  return <RepositoriesPage key={organization.id} organization={organization} onNotify={notify} />;
}

export function RepositoryDetailRoute() {
  const { organization } = useOutletContext<OrganizationOutletContext>();
  const { repositorySlug = "" } = useParams();
  return <RepositoryDetailPage key={`${organization.id}:${repositorySlug}`} organization={organization} repositorySlug={repositorySlug} />;
}

export function WebIDERoute() {
  const { organization } = useOutletContext<OrganizationOutletContext>();
  return <WebIDEPage key={organization.id} organization={organization} />;
}

/** The workspace editor is scoped to one repository, so it reads the owner and name from the path. */
export function WorkspaceEditorRoute() {
  const { organization } = useOutletContext<OrganizationOutletContext>();
  const notify = useNotify();
  return <WorkspaceEditorPage key={`${organization.id}:${window.location.pathname}`} organization={organization} onNotify={notify} />;
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
