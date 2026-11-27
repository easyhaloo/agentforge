import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { routes } from "./app/routes";
import { NotificationProvider, UIThemeProvider } from "./shared/ui";
import "./locales";
import "./styles/index.css";
import "./styles/i18n-layout.css";
import "./shared/ui/theme/theme.css";
import "./shared/ui/components/components.css";
import "./shared/ui/components/primer.css";

const router = createBrowserRouter(routes);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <UIThemeProvider>
      <NotificationProvider>
        <RouterProvider router={router} />
      </NotificationProvider>
    </UIThemeProvider>
  </React.StrictMode>,
);
