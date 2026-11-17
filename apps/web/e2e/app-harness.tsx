import React from "react";
import { createRoot } from "react-dom/client";
import App from "../src/app/App";
import { NotificationProvider, UIThemeProvider } from "../src/shared/ui";
import "../src/styles/index.css";
import "../src/shared/ui/theme/theme.css";
import "../src/shared/ui/components/components.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <UIThemeProvider>
      <NotificationProvider>
        <App />
      </NotificationProvider>
    </UIThemeProvider>
  </React.StrictMode>,
);
