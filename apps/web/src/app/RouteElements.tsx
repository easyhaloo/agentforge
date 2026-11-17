import { Link, useLocation, useOutletContext } from "react-router-dom";
import { DeliveryFlow } from "../features/delivery";
import { ChangesetsPage } from "../pages/changesets/ChangesetsPage";
import { OrganizationManagementPage } from "../pages/organization/OrganizationManagementPage";
import { OverviewPage } from "../pages/overview";
import { ResourceWorkspacePage } from "../pages/resources";
import { flatPaths } from "../shared/routing";
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
  const { organization, account } = useOutletContext<OrganizationOutletContext>();
  const notify = useNotify();
  return <ChangesetsPage key={organization.id} organization={organization} accountUserID={account.user_id} onNotify={notify} />;
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
