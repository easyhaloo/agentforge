import { authReturnPath } from "../../shared/routing";
import { Navigate, Link, useSearchParams, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useState, useEffect, type FormEvent } from "react";
import { Alert, Button, Input, PasswordInput } from "../../shared/ui";
import { authAPI, APIError } from "../../shared/api/identity";
import { SSOProviders } from "../../features/sso/SSOProviders";
import "./LoginPage.css";

const ssoErrorLabels = {
  cancelled: "ssoError.cancelled",
  failed: "ssoError.failed",
  access_required: "ssoError.accessRequired",
  invitation_invalid: "ssoError.invitationInvalid",
  unavailable: "error.unavailable",
} as const;

export function LoginPage() {
  const { t } = useTranslation("login");
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Check if user is already authenticated
  useEffect(() => {
    fetch("/api/v1/me", { credentials: "include" })
      .then((response) => { if (response.ok) setAuthenticated(true); })
      .catch(() => { /* The form remains available if the session check fails. */ });
  }, []);

  const returnPath = authReturnPath(location.state?.from ?? searchParams.get("return"));
  const destination = returnPath ?? "/orgs/current/changesets";
  const isInvitation = searchParams.get("invitation") === "1";
  const errorCode = searchParams.get("sso_error");
  const ssoError = errorCode && Object.hasOwn(ssoErrorLabels, errorCode)
    ? ssoErrorLabels[errorCode as keyof typeof ssoErrorLabels]
    : undefined;

  if (authenticated && !isInvitation && !ssoError) {
    return <Navigate to={destination} replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
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
      await authAPI.localLogin(email.trim(), password);
      navigate(destination, { replace: true });
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
    <main className="login-page" aria-labelledby="login-heading">
      <header className="login-header">
        <div className="login-mark" aria-hidden="true">AF</div>
        <h1 id="login-heading">{t("title")}</h1>
      </header>

      <div className="login-card">
        {isInvitation && <Alert className="login-notice">{t("invitation")}</Alert>}
        {ssoError && <Alert className="login-notice" status="error">{t(ssoError)}</Alert>}
        <form className="local-login-form" onSubmit={handleSubmit}>
          {error && <Alert status="error">{error}</Alert>}
          <Input
            type="email"
            name="email"
            label={t("email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            controlSize="large"
          />
          <PasswordInput
            name="password"
            label={t("password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            controlSize="large"
          />
          <Button type="submit" variant="primary" size="large" loading={loading}>
            {loading ? t("loading") : t("signInButton")}
          </Button>
        </form>

        <SSOProviders divider={t("orSignInWith")} legacyLabel={t("providers.oidc")} returnPath={returnPath} />
      </div>

      <p className="login-register">
        {t("noAccount")} <Link to={returnPath ? `/register?return=${encodeURIComponent(returnPath)}` : "/register"}>{t("createAccountLink")}</Link>
      </p>
    </main>
  );
}
