import type { ReactElement } from "react";
import { Navigate, type RouteObject } from "react-router-dom";
import { UIShowcasePage } from "../pages/ui-showcase";
import {
  ProfileSettingsPage,
  AccountSettingsPage,
  AppearanceSettingsPage,
  NotificationsSettingsPage,
  AuthenticationSettingsPage,
  KeysSettingsPage,
  SessionsSettingsPage,
  AgentSettingsPage,
} from "../pages/settings";
import type { ChangesetTab } from "../shared/routing";
import App from "./App";
import type { RouteHandle } from "./navigation";
import { OrganizationGate } from "./OrganizationGate";
import { FocusedLayout } from "./layouts/FocusedLayout";
import { ChangesetDetailRoute, ChangesetsRoute, DeliveryRoute, LoginRoute, RegisterRoute, NotFound, OrganizationRoute, OverviewRoute, PageError, PipelineEditorRoute, PipelineRunRoute, PipelinesRoute, RepositoriesRoute, RepositoryDetailRoute, WebIDERoute, WorkspaceEditorRoute, ResourceRoute, RootError, SettingsRoute, ReviewRoute, EvalRoute, TrailsRoute } from "./RouteElements";

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
  // Login and register routes - NO shell (siblings to App, not children)
  {
    path: "/login",
    element: <LoginRoute />,
    errorElement: <RootError />,
  },
  {
    path: "/register",
    element: <RegisterRoute />,
    errorElement: <RootError />,
  },

  // Settings - Focused layout (independent page with its own navigation)
  {
    path: "/settings",
    element: <FocusedLayout />,
    errorElement: <RootError />,
    children: [
      {
        errorElement: <PageError />,
        children: [
          {
            element: <SettingsRoute />,
            children: [
              { index: true, handle: routeHandle("Settings"), element: <Navigate to="/settings/profile" replace /> },
              { path: "profile", handle: routeHandle("Public profile"), element: <ProfileSettingsPage /> },
              { path: "account", handle: routeHandle("Account"), element: <AccountSettingsPage /> },
              { path: "appearance", handle: routeHandle("Appearance"), element: <AppearanceSettingsPage /> },
              { path: "notifications", handle: routeHandle("Notifications"), element: <NotificationsSettingsPage /> },
              { path: "authentication", handle: routeHandle("Password and authentication"), element: <AuthenticationSettingsPage /> },
              { path: "keys", handle: routeHandle("SSH and GPG keys"), element: <KeysSettingsPage /> },
              { path: "sessions", handle: routeHandle("Sessions"), element: <SessionsSettingsPage /> },
              { path: "agents", handle: routeHandle("Agent Interactions"), element: <AgentSettingsPage /> },
            ],
          },
        ],
      },
    ],
  },

  {
    element: <FocusedLayout fullscreen />,
    errorElement: <RootError />,
    children: [{ element: <OrganizationGate variant="pipelines" />, errorElement: <PageError />,
      children: [
        organizationPage("pipelines/:id/edit", "CI / CD", <PipelineEditorRoute />),
        organizationPage("pipeline-runs/:runId", "CI / CD", <PipelineRunRoute />),
      ] }],
  },

  // All other routes - WITH shell (main workspace layout)
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
          delivery("self-healing", "Self-healing"),
          resource("memory", "Memory"),
          {
            element: <OrganizationGate variant="repositories" />,
            children: [
              organizationPage("repositories", "Repositories", <RepositoriesRoute />),
              {
                path: "orgs/:org/repositories/:repositorySlug",
                handle: routeHandle("Repository"),
                element: <RepositoryDetailRoute />,
              },
              {
                path: "orgs/:org/webide/:owner/:repo",
                handle: routeHandle("WebIDE"),
                element: <WorkspaceEditorRoute />,
              },
            ],
          },
          { element: <OrganizationGate variant="pipelines" />, children: [organizationPage("pipelines", "CI / CD", <PipelinesRoute />)] },
          resource("security", "Security"),
          resource("governance", "Governance"),
          resource("usage", "Cost & Usage"),
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
              organizationPage("webide", "WebIDE", <WebIDERoute />),
              organizationPage("trails", "Trails", <TrailsRoute />),
              organizationPage("review", "Review", <ReviewRoute />),
              organizationPage("eval", "Eval", <EvalRoute />),
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
