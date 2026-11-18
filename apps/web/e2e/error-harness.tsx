import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { routes } from "../src/app/routes";
import i18n from "../src/locales";
import { NotificationProvider, UIThemeProvider } from "../src/shared/ui";
import i18n from "../src/locales";
import "../src/styles/index.css";
import "../src/shared/ui/theme/theme.css";
import "../src/shared/ui/components/components.css";

// Mounts the real route table with something that always fails to render, so the error boundaries can be tested
// without depending on any page's data. The message is recognizable: it must never reach the user.
function Explode(): never {
  throw new Error("KABOOM-secret-detail");
}

// Adds a page that throws next to the real pages, wherever they sit in the route tree.
function withExplodingPage(table: RouteObject[]): RouteObject[] {
  return table.map((route) => {
    if (route.children?.some((child) => child.path === "projects")) {
      return { ...route, children: [...route.children, { path: "explode", element: <Explode /> }] } as RouteObject;
    }
    return route.children ? { ...route, children: withExplodingPage(route.children) } as RouteObject : route;
  });
}

// ?scenario=page: a page fails.  ?scenario=app: the root layout itself fails.
const appFails = new URLSearchParams(window.location.search).get("scenario") === "app";
const router = appFails
  ? createMemoryRouter(routes.map((route) => ({ ...route, element: <Explode /> }) as RouteObject), { initialEntries: ["/"] })
  : createMemoryRouter(withExplodingPage(routes), { initialEntries: ["/explode"] });

createRoot(document.getElementById("root")!).render(
  <I18nextProvider i18n={i18n}>
    <UIThemeProvider>
      <NotificationProvider>
        <RouterProvider router={router} />
      </NotificationProvider>
    </UIThemeProvider>
  </I18nextProvider>,
);
