import { Navigate, Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useState, useEffect, type FormEvent } from "react";
import { Input } from "../../shared/ui/components";
import { PasswordInput } from "../../shared/ui/components/form-controls";
import { Button } from "../../shared/ui/components";
import { authAPI, APIError } from "../../shared/api/identity";
import { getEnabledProviders, type SSOProvider } from "../../shared/api/providers";
import "./LoginPage.css";

type AuthCheckState = "checking" | "authenticated" | "unauthenticated";

export function LoginPage() {
  const { t } = useTranslation("login");
  const [searchParams] = useSearchParams();
  const [authState, setAuthState] = useState<AuthCheckState>("unauthenticated");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [ssoProviders, setSSOProviders] = useState<SSOProvider[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);

  // Check if user is already authenticated
  useEffect(() => {
    fetch("/api/v1/me", { credentials: "include" })
      .then((res) => {
        if (res.ok) {
          setAuthState("authenticated");
        } else {
          setAuthState("unauthenticated");
        }
      })
      .catch(() => {
        setAuthState("unauthenticated");
      });
  }, []);

  // Load available SSO providers
  useEffect(() => {
    getEnabledProviders()
      .then((providers) => {
        setSSOProviders(providers);
      })
      .catch(() => {
        // Silently fail - SSO will just not be available
        setSSOProviders([]);
      })
      .finally(() => {
        setLoadingProviders(false);
      });
  }, []);

  // Redirect authenticated users to return URL or default page
  if (authState === "authenticated" || loginSuccess) {
    const returnUrl = searchParams.get("return");
    const destination = (returnUrl && returnUrl.startsWith("/")) ? returnUrl : "/orgs/current/changesets";
    return <Navigate to={destination} replace />;
  }

  // Render provider-specific icon
  const renderProviderIcon = (providerId: string) => {
    switch (providerId) {
      case "github":
        return (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
        );
      case "google":
        return (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M15.545 6.558a9.42 9.42 0 01.139 1.626c0 2.434-.87 4.492-2.384 5.885h.002C11.978 15.292 10.158 16 8 16A8 8 0 118 0a7.689 7.689 0 015.352 2.082l-2.284 2.284A4.347 4.347 0 008 3.166c-2.087 0-3.86 1.408-4.492 3.304a4.792 4.792 0 000 3.063h.003c.635 1.893 2.405 3.301 4.492 3.301 1.078 0 2.004-.276 2.722-.764h-.003a3.702 3.702 0 001.599-2.431H8v-3.08h7.545z" fill="#4285F4"/>
          </svg>
        );
      case "apple":
        return (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M11.182.008C11.148-.03 9.923.023 8.857 1.18c-1.066 1.156-.902 2.482-.878 2.516.024.034 1.52.087 2.475-1.258.955-1.345.762-2.391.728-2.43zm3.314 11.733c-.048-.096-2.325-1.234-2.113-3.422.212-2.189 1.675-2.789 1.698-2.854.023-.065-.597-.79-1.254-1.157a3.692 3.692 0 00-1.563-.434c-.108-.003-.483-.095-1.254.116-.508.139-1.653.589-1.968.607-.316.018-1.256-.522-2.267-.665-.647-.125-1.333.131-1.824.328-.49.196-1.422.754-2.074 2.237-.652 1.482-.311 3.83-.067 4.56.244.729.625 1.924 1.273 2.796.576.984 1.34 1.667 1.659 1.899.319.232 1.219.386 1.843.067.502-.308 1.408-.485 1.766-.472.357.013 1.061.154 1.782.539.571.197 1.111.115 1.652-.105.541-.221 1.324-1.059 2.238-2.758.347-.79.505-1.217.473-1.282z"/>
          </svg>
        );
      case "oidc":
      default:
        return (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M12 7H4V4C4 2.89543 4.89543 2 6 2H10C11.1046 2 12 2.89543 12 4V7Z" stroke="currentColor" strokeWidth="1.5"/>
            <rect x="3" y="7" width="10" height="7" rx="1" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="8" cy="10.5" r="1" fill="currentColor"/>
          </svg>
        );
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    // Client-side validation
    if (!email.trim()) {
      setError(t("error.emptyEmail"));
      return;
    }
    if (!password) {
      setError(t("error.emptyPassword"));
      return;
    }

    setLoading(true);
    try {
      await authAPI.localLogin(email, password);
      setLoginSuccess(true);
    } catch (err) {
      if (err instanceof APIError) {
        if (err.status === 401) {
          setError(t("error.invalidCredentials"));
        } else {
          setError(t("error.generic"));
        }
      } else if (err instanceof TypeError) {
        setError(t("error.networkError"));
      } else {
        setError(t("error.generic"));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page" role="main" aria-labelledby="login-heading">
      <div className="login-card card">
        <header className="login-header">
          <div className="brand-mark" aria-hidden="true">AF</div>
          <h1 id="login-heading" className="product-name">{t("title")}</h1>
          <p className="tagline">{t("tagline")}</p>
        </header>

        <form className="local-login-form" onSubmit={handleSubmit}>
          <Input
            type="email"
            name="email"
            label={t("email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <PasswordInput
            name="password"
            label={t("password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}
          <Button
            type="submit"
            variant="primary"
            loading={loading}
            className="login-button"
          >
            {t("signInButton")}
          </Button>
        </form>

        <p className="auth-link">
          {t("noAccount")} <Link to="/register">{t("createAccountLink")}</Link>
        </p>

        {!loadingProviders && ssoProviders.length > 0 && (
          <>
            <div className="login-divider">
              <span>{t("orSignInWith")}</span>
            </div>

            <div className="sso-providers">
              {ssoProviders.map((provider) => (
                <a
                  key={provider.id}
                  href={provider.loginUrl}
                  className="button secondary login-button sso-button"
                  aria-label={t(`providers.${provider.id}`, { defaultValue: provider.name })}
                >
                  {renderProviderIcon(provider.id)}
                  {t(`providers.${provider.id}`, { defaultValue: provider.name })}
                </a>
              ))}
            </div>
          </>
        )}

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
