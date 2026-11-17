import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { UIThemeProvider } from "./shared/ui";
import "./styles/index.css";
import "./shared/ui/theme/theme.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <UIThemeProvider>
      <App />
    </UIThemeProvider>
  </React.StrictMode>,
);
