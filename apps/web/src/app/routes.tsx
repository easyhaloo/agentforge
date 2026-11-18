import type { ReactElement } from "react";
import type { RouteObject } from "react-router-dom";
import { UIShowcasePage } from "../pages/ui-showcase";
import type { ChangesetTab } from "../shared/routing";
import App from "./App";
import type { RouteHandle } from "./navigation";
import { OrganizationGate } from "./OrganizationGate";
import { ChangesetDetailRoute, ChangesetsRoute, DeliveryRoute, LoginRoute, NotFound, OrganizationRoute, OverviewRoute, PageError, RepositoriesRoute, ResourceRoute, RootError, WebIDERoute } from "./RouteElements";

/**
 * The only place that knows the whole URL tree (see ADR-008). Every leaf declares its label in `handle`;
 * it must equal the matching item in navigation.ts (routes.test.ts enforces this).
 * `/api/*` and `/auth/*` are backend paths on the same origin and are deliberately not routes.
 * Mock pages are flat; pages backed by the real API live under `orgs/:org` behind an OrganizationGate.
 * Every page sits under a pathless layout route that carries the errorElement, so a failing page replaces only the
 * page area and the shell stays; the root route has a minimal fallback for errors thrown by the layout itself.
 */
const routeHandle = (label: string): RouteHandle => ({ label });
const resource = (path: string, label: string): RouteObject => ({ path, handle: routeHandle(label), element: <ResourceRoute label={label} /> });
const delivery = (path: string, label: string): RouteObject => ({ path, handle: routeHandle(label), element: <DeliveryRoute label={label} /> });
const organizationPage = (section: string, label: string, element: ReactElement): RouteObject => ({ path: `orgs/:org/${section}`, handle: routeHandle(label), element });
/** Each part of a changeset is its own route, so every step of the lifecycle is linkable. */
const changesetDetail = (tab: ChangesetTab): RouteObject => ({
  path: tab === "overview" ? "orgs/:org/changesets/:id" : `orgs/:org/changesets/:id/${tab}`,
  handle: routeHandle("Changeset"),
  element: <ChangesetDetailRoute tab={tab} />,
});

export const routes: RouteObject[] = [
  // Login route - NO shell (sibling to App, not child)
  {
    path: "/login",
    element: <LoginRoute />,
    errorElement: <RootError />,
  },

  // All other routes - WITH shell
  {
    path: "/",
    element: <App />,
    errorElement: <RootError />,
    children: [
      {
        errorElement: <PageError />,
        children: [
          { index: true, handle: routeHandle("Overview"), element: <OverviewRoute /> },
          resource("projects", "Projects"),
          resource("workspaces", "Workspaces"),
          delivery("stacks", "Stacks"),
          delivery("self-healing", "Self-healing"),
          resource("memory", "Memory"),
          resource("pipelines", "CI / CD"),
          resource("security", "Security"),
          resource("governance", "Governance"),
          resource("usage", "Cost & Usage"),
          resource("settings", "Settings"),
          { path: "dev/ui", handle: routeHandle("UI Components"), element: <UIShowcasePage /> },
          {
            element: <OrganizationGate variant="changesets" />,
            children: [
              organizationPage("changesets", "Changesets", <ChangesetsRoute />),
              changesetDetail("overview"),
              changesetDetail("revisions"),
              changesetDetail("evaluation"),
              changesetDetail("review"),
              changesetDetail("merge"),
              organizationPage("repositories", "Repositories", <RepositoriesRoute />),
              { path: "orgs/:org/webide/:owner/:repo", handle: routeHandle("Repositories"), element: <WebIDERoute /> },
              // Aliases of the changeset workspace until Trails, Review and Eval get their own pages.
              organizationPage("trails", "Trails", <ChangesetsRoute />),
              organizationPage("review", "Review", <ChangesetsRoute />),
              organizationPage("eval", "Eval", <ChangesetsRoute />),
            ],
          },
          {
            element: <OrganizationGate variant="organization" />,
            children: [organizationPage("settings", "Organization", <OrganizationRoute />)],
          },
          { path: "*", handle: routeHandle("Page not found"), element: <NotFound /> },
        ],
      },
    ],
  },
];
