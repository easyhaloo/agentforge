import { useEffect } from "react";
import { Link, useLocation, useOutletContext, useParams, useRouteError } from "react-router-dom";
import { DeliveryFlow } from "../features/delivery";
import { ChangesetDetailPage } from "../pages/changesets/ChangesetDetailPage";
import { ChangesetsPage } from "../pages/changesets/ChangesetsPage";
import { OrganizationManagementPage } from "../pages/organization/OrganizationManagementPage";
import { OverviewPage } from "../pages/overview";
import { RepositoriesPage } from "../pages/repositories/RepositoriesPage";
import { ResourceWorkspacePage } from "../pages/resources";
import { flatPaths, type ChangesetTab } from "../shared/routing";
import type { OrganizationOutletContext } from "./OrganizationGate";
import { useNotify } from "./useNotify";

// Thin adapters between the route table and the pages: they supply what a page needs from the
// shell (notifications, the organization resolved by the gate) so the pages keep their props.

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

export function RepositoriesRoute() {
  const { organization } = useOutletContext<OrganizationOutletContext>();
  const notify = useNotify();
  return <RepositoriesPage key={organization.id} organization={organization} onNotify={notify} />;
}

export function OrganizationRoute() {
  const { organization } = useOutletContext<OrganizationOutletContext>();
  const notify = useNotify();
  return <OrganizationManagementPage key={organization.id} organization={organization} onNotify={notify} />;
}

export function NotFound() {
  const { pathname } = useLocation();
  return (
    <section className="card org-auth-state">
      <p>Nothing is served at {pathname}.</p>
      <Link className="button primary" to={flatPaths.overview}>Go to Overview</Link>
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
  return (
    <section className="card org-auth-state" role="alert">
      <h2>Something went wrong</h2>
      <p>This page could not be displayed. Try again later, or go back to the overview.</p>
      <Link className="button primary" to={flatPaths.overview}>Go to Overview</Link>
    </section>
  );
}

/** Last resort for errors thrown by the root layout itself, when there is no shell to keep. */
export function RootError() {
  useLogRouteError();
  return (
    <div className="content">
      <section className="card org-auth-state" role="alert">
        <h2>Something went wrong</h2>
        <p>AgentForge could not be displayed. Reload the page to try again.</p>
        <a className="button primary" href="/">Reload AgentForge</a>
      </section>
    </div>
  );
}
