import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import "./LoginPage.css";

export type LoginPageProps = {
  accountState: "loading" | "ready" | "signed-out" | "unavailable";
};

export function LoginPage({ accountState }: LoginPageProps) {
  const { t } = useTranslation("login");

  // Show loading state while checking authentication
  if (accountState === "loading") {
    return (
      <main className="login-page" role="main">
        <div className="login-card card">
          <div className="login-loading">{t("loading")}</div>
        </div>
      </main>
    );
  }

  // Redirect authenticated users to changesets
  if (accountState === "ready") {
    return <Navigate to="/orgs/current/changesets" replace />;
  }

  return (
    <main className="login-page" role="main" aria-labelledby="login-heading">
      <div className="login-card card">
        <header className="login-header">
          <div className="brand-mark" aria-hidden="true">AF</div>
          <h1 id="login-heading" className="product-name">{t("title")}</h1>
          <p className="tagline">{t("tagline")}</p>
        </header>

        <a
          href="/auth/oidc/login"
          className="button primary login-button"
          aria-label={t("ssoButton")}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M12 7H4V4C4 2.89543 4.89543 2 6 2H10C11.1046 2 12 2.89543 12 4V7Z"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <rect
              x="3"
              y="7"
              width="10"
              height="7"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle cx="8" cy="10.5" r="1" fill="currentColor" />
          </svg>
          {t("ssoButton")}
        </a>

        <p className="trust-message">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-label="Secure"
          >
            <path
              d="M7 1L2 3.5V6.5C2 9.5 4 11.5 7 13C10 11.5 12 9.5 12 6.5V3.5L7 1Z"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
            />
            <path
              d="M5.5 7L6.5 8L8.5 6"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {t("trustMessage")}
        </p>
      </div>

      <footer className="login-footer">
        <span>AgentForge v0.1.0</span>
      </footer>
    </main>
  );
}
