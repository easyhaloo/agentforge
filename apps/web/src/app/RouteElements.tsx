import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useOutletContext, useParams, useRouteError, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DeliveryFlow } from "../features/delivery";
import { ChangesetDetailPage } from "../pages/changesets/ChangesetDetailPage";
import { ChangesetsPage } from "../pages/changesets/ChangesetsPage";
import { ReviewPage } from "../pages/review";
import { EvalPage } from "../pages/eval";
import { TrailsPage } from "../pages/trails";
import { OrganizationManagementPage } from "../pages/organization/OrganizationManagementPage";
import { NotificationsPage } from "../pages/notifications/NotificationsPage";
import { OverviewPage, OverviewUnavailable } from "../pages/overview";
import { PipelineRunPage } from "../pages/pipelines/PipelineRunPage";
import { PipelineEditorPage, PipelinesPage } from "../pages/pipelines/PipelinesPage";
import { RepositoriesPage } from "../pages/repositories/RepositoriesPage";
import { RepositoryCreatePage } from "../pages/repositories/RepositoryCreatePage";
import { RepositoryBrowserPage } from "../pages/repositories/RepositoryBrowserPage";
import { RepositorySectionPage } from "../pages/repositories/RepositorySectionPage";
import { RepositoryDetailPage } from "../pages/repositories/RepositoryDetailPage";
import { RepositoryIssues } from "../pages/repositories/RepositoryIssues";
import { IssueDetailPage } from "../pages/repositories/IssueDetailPage";
import { PullRequestListPage, PullRequestComparePage, PullRequestDetailPage } from "../pages/pulls";
import { IssueCreation } from "../pages/repositories/IssueCreation";
import { WebIDEPage } from "../pages/webide/WebIDEPage";
import { WorkspaceEditorPage } from "../pages/webide/WorkspaceEditorPage";
import { ResourceWorkspacePage } from "../pages/resources";
import { IssueProjectsPanel } from "../pages/repositories/IssueProjectsPanel";
import { SettingsLayout } from "../pages/settings/SettingsLayout";
import { Button, Loading } from "../shared/ui";
import { flatPaths, organizationHandle, repositoryPath, repositoryNewPath, type ChangesetTab, type PullRequestTab, type RepositorySection } from "../shared/routing";
import type { OrganizationOutletContext } from "./OrganizationGate";
import { PageHeader } from "./components/PageHeader";
import { useAppAccount } from "./account-context";
import { useNotify } from "./useNotify";
import { LoginRedirect } from "./LoginRedirect";
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
  if (accountState === "signed-out") return <LoginRedirect />;
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
  const { selectedOrganization } = useAppAccount();
  return <>
    {label === "Projects" && selectedOrganization && <IssueProjectsPanel key={selectedOrganization.id} organization={selectedOrganization} />}
    <ResourceWorkspacePage key={label} page={label} onNotify={notify} />
  </>;
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
  const { organization, account } = useOutletContext<OrganizationOutletContext>();
  const { runId = "" } = useParams();
  return <PipelineRunPage key={`${organization.id}:${runId}`} organization={organization} actorId={account.user_id} runId={runId} />;
}

export function NotificationsRoute() {
  const { organization, account } = useOutletContext<OrganizationOutletContext>();
  return <NotificationsPage key={`${organization.id}:${account.user_id}`} organization={organization} />;
}

export function OrganizationIssuesRoute() {
  const { organization, account } = useOutletContext<OrganizationOutletContext>();
  return <RepositoryIssues key={organization.id} organization={organization}
    organizationHandle={organizationHandle(organization)} currentUser={account.user_id} />;
}

export function RepositoriesRoute() {
  const { organization, account } = useOutletContext<OrganizationOutletContext>();
  const [search] = useSearchParams();
  const { hash } = useLocation();
  const handle = organizationHandle(organization);
  const repository = search.get("repository");
  if (repository && /^[^/]+\/[^/]+$/.test(repository)) {
    const params = new URLSearchParams(search);
    params.delete("repository");
    return <Navigate replace to={{ pathname: repositoryPath(handle, repository), search: params.toString(), hash }} />;
  }
  // Legacy redirect: ?register=1 -> /orgs/:org/repositories/new
  if (search.get("register") === "1") {
    return <Navigate replace to={{ pathname: repositoryNewPath(handle), search: "?mode=register" }} />;
  }
  return <RepositoriesPage key={organization.id} organization={organization} userID={account.user_id} />;
}

export function RepositoryCreateRoute() {
  const { organization, account } = useOutletContext<OrganizationOutletContext>();
  const notify = useNotify();
  return <RepositoryCreatePage key={organization.id} organization={organization} account={account} onNotify={notify} />;
}

export function RepositoryDetailRoute({ section }: { section?: RepositorySection }) {
  const { organization, account } = useOutletContext<OrganizationOutletContext>();
  const { owner, repo, repositorySlug } = useParams();
  const notify = useNotify();
  if (repositorySlug) {
    return <RepositoryDetailPage key={`${organization.id}:${repositorySlug}`} organization={organization} repositorySlug={repositorySlug} />;
  }
  const repository = `${owner}/${repo}`;
  if (section) return <RepositorySectionPage key={`${organization.id}:${repository}:${section}`} organization={organization} repository={repository} section={section} currentUser={account.user_id} onNotify={notify}/>;
  return <RepositoryBrowserPage key={`${organization.id}:${repository}`} organization={organization} repository={repository} onNotify={notify} />;
}

export function IssueDetailRoute() {
  const { organization, account } = useOutletContext<OrganizationOutletContext>();
  const { owner, repo, number } = useParams();
  const notify = useNotify();
  const repository = `${owner}/${repo}`;
  const issueNumber = Number(number);
  return <section className="repo-layout repo-browser">
    <IssueDetailPage key={`${organization.id}:${repository}:${issueNumber}`} organization={organization} repository={repository} issueNumber={issueNumber} currentUser={account.user_id} onNotify={notify} />
  </section>;
}

export function IssueCreateRoute({ chooseTemplate = false }: { chooseTemplate?: boolean }) {
  const { organization, account } = useOutletContext<OrganizationOutletContext>();
  const { owner, repo } = useParams();
  const notify = useNotify();
  if (!owner || !repo) return null;
  return <section className="repo-layout repo-browser">
    <IssueCreation key={`${organization.id}:${owner}/${repo}:${chooseTemplate}`} chooseTemplate={chooseTemplate} organization={organization} owner={owner} repo={repo} currentUser={account.user_id} onNotify={notify} />
  </section>;
}

export function PullRequestListRoute() {
  const { organization } = useOutletContext<OrganizationOutletContext>();
  const { owner, repo } = useParams();
  const repository = `${owner}/${repo}`;
  const handle = organizationHandle(organization);
  return <section className="repo-layout repo-browser">
    <PullRequestListPage key={`${organization.id}:${repository}`} organization={organization} repository={repository} handle={handle} />
  </section>;
}

export function PullRequestCompareRoute() {
  const { organization } = useOutletContext<OrganizationOutletContext>();
  const { owner, repo } = useParams();
  const repository = `${owner}/${repo}`;
  const handle = organizationHandle(organization);
  return <section className="repo-layout repo-browser">
    <PullRequestComparePage key={`${organization.id}:${repository}`} organization={organization} repository={repository} handle={handle} />
  </section>;
}

export function PullRequestDetailRoute({ tab }: { tab: PullRequestTab }) {
  const { organization, account } = useOutletContext<OrganizationOutletContext>();
  const { owner, repo, id = "" } = useParams();
  const repository = `${owner}/${repo}`;
  const handle = organizationHandle(organization);
  return <section className="repo-layout repo-browser">
    <PullRequestDetailPage key={`${organization.id}:${repository}:${id}`} organization={organization} repository={repository} handle={handle} pullNumber={id} tab={tab} userID={account.user_id} />
  </section>;
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

export function ReviewRoute() {
  const { organization } = useOutletContext<OrganizationOutletContext>();
  const notify = useNotify();
  return <ReviewPage key={organization.id} organization={organization} onNotify={notify} />;
}

export function EvalRoute() {
  const { organization } = useOutletContext<OrganizationOutletContext>();
  const notify = useNotify();
  return <EvalPage key={organization.id} organization={organization} onNotify={notify} />;
}

export function TrailsRoute() {
  const { organization } = useOutletContext<OrganizationOutletContext>();
  const notify = useNotify();
  return <TrailsPage key={organization.id} organization={organization} onNotify={notify} />;
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
