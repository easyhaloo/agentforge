import type { ReactElement } from "react";
import type { RouteObject } from "react-router-dom";
import { UIShowcasePage } from "../pages/ui-showcase";
import App from "./App";
import type { RouteHandle } from "./navigation";
import { OrganizationGate } from "./OrganizationGate";
import { ChangesetsRoute, DeliveryRoute, NotFound, OrganizationRoute, OverviewRoute, ResourceRoute } from "./RouteElements";

/**
 * The only place that knows the whole URL tree (see ADR-008). Every leaf declares its label in `handle`;
 * it must equal the matching item in navigation.ts (routes.test.ts enforces this).
 * `/api/*` and `/auth/*` are backend paths on the same origin and are deliberately not routes.
 * Mock pages are flat; pages backed by the real API live under `orgs/:org` behind an OrganizationGate.
 */
const routeHandle = (label: string): RouteHandle => ({ label });
const resource = (path: string, label: string): RouteObject => ({ path, handle: routeHandle(label), element: <ResourceRoute label={label} /> });
const delivery = (path: string, label: string): RouteObject => ({ path, handle: routeHandle(label), element: <DeliveryRoute label={label} /> });
const organizationPage = (section: string, label: string, element: ReactElement): RouteObject => ({ path: `orgs/:org/${section}`, handle: routeHandle(label), element });

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, handle: routeHandle("Overview"), element: <OverviewRoute /> },
      resource("projects", "Projects"),
      resource("repositories", "Repositories"),
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
];
