import { type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppAccount } from "./account-context";

interface RequireAuthProps {
  children: ReactNode;
}

/**
 * Route guard that redirects to /login if the user is not authenticated.
 * Preserves the intended destination so the user can be redirected back after login.
 */
export function RequireAuth({ children }: RequireAuthProps) {
  const { t } = useTranslation("app");
  const { accountState } = useAppAccount();
  const location = useLocation();

  // Show nothing while loading to avoid flash of content
  if (accountState === "loading") {
    return null;
  }

  // Redirect to login if signed out
  if (accountState === "signed-out") {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  // Show error state but don't redirect (API temporarily unavailable)
  if (accountState === "unavailable") {
    return (
      <div style={{
        padding: "48px 24px",
        textAlign: "center",
        color: "var(--color-text-secondary)"
      }}>
        <h2 style={{ marginBottom: "12px", color: "var(--color-text-primary)" }}>
          {t("app:errors.authUnavailableTitle")}
        </h2>
        <p>{t("app:errors.authUnavailableBody")}</p>
      </div>
    );
  }

  // accountState === "ready" - render the protected content
  return <>{children}</>;
}
