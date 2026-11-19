import { Navigate, Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useState, useEffect, type FormEvent } from "react";
import { Input } from "../../shared/ui/components";
import { PasswordInput } from "../../shared/ui/components/form-controls";
import { Button } from "../../shared/ui/components";
import { authAPI, APIError } from "../../shared/api/identity";
import "./RegisterPage.css";

type AuthCheckState = "checking" | "authenticated" | "unauthenticated";
type PasswordStrength = "weak" | "medium" | "strong";

function getPasswordStrength(password: string): PasswordStrength {
  if (password.length < 8) return "weak";

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);

  const criteriaCount = [hasLower, hasUpper, hasNumber, hasSpecial].filter(Boolean).length;

  if (password.length >= 12 && criteriaCount >= 3) return "strong";
  if (password.length >= 8 && criteriaCount >= 2) return "medium";
  return "weak";
}

export function RegisterPage() {
  const { t } = useTranslation("register");
  const [searchParams] = useSearchParams();
  const [authState, setAuthState] = useState<AuthCheckState>("unauthenticated");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [registerSuccess, setRegisterSuccess] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState<PasswordStrength>("weak");

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

  // Update password strength indicator
  useEffect(() => {
    if (password) {
      setPasswordStrength(getPasswordStrength(password));
    }
  }, [password]);

  // Redirect authenticated users
  if (authState === "authenticated" || registerSuccess) {
    const returnUrl = searchParams.get("return");
    const destination = (returnUrl && returnUrl.startsWith("/")) ? returnUrl : "/orgs/current/changesets";
    return <Navigate to={destination} replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    // Client-side validation
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError(t("errors.emailRequired"));
      return;
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setError(t("errors.emailInvalid"));
      return;
    }

    if (!displayName.trim()) {
      setError(t("errors.nameRequired"));
      return;
    }

    if (!password) {
      setError(t("errors.passwordRequired"));
      return;
    }

    if (password.length < 8) {
      setError(t("errors.passwordWeak"));
      return;
    }

    if (password !== confirmPassword) {
      setError(t("errors.passwordMismatch"));
      return;
    }

    setLoading(true);
    try {
      await authAPI.registerUser(trimmedEmail, password, displayName.trim());
      setRegisterSuccess(true);
    } catch (err) {
      if (err instanceof APIError) {
        if (err.status === 409) {
          setError(t("errors.emailExists"));
        } else {
          setError(t("errors.generic"));
        }
      } else if (err instanceof TypeError) {
        setError(t("errors.networkError"));
      } else {
        setError(t("errors.generic"));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="register-page" role="main" aria-labelledby="register-heading">
      <div className="register-card card">
        <header className="register-header">
          <div className="brand-mark" aria-hidden="true">AF</div>
          <h1 id="register-heading" className="product-name">{t("title")}</h1>
          <p className="tagline">{t("tagline")}</p>
        </header>

        <form className="register-form" onSubmit={handleSubmit} noValidate>
          <Input
            type="email"
            name="email"
            label={t("email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />

          <Input
            type="text"
            name="displayName"
            label={t("displayName")}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="name"
          />

          <div className="password-field-group">
            <PasswordInput
              name="password"
              label={t("password")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            {password && (
              <div className={`password-strength password-strength--${passwordStrength}`} role="status">
                <div className="password-strength__bar" />
                <span className="password-strength__label">
                  {t(`passwordStrength.${passwordStrength}`)}
                </span>
              </div>
            )}
          </div>

          <PasswordInput
            name="confirmPassword"
            label={t("confirmPassword")}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />

          {error && (
            <div className="register-error" role="alert">
              {error}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            loading={loading}
            className="register-button"
          >
            {t("createButton")}
          </Button>
        </form>

        <p className="auth-link">
          {t("hasAccount")} <Link to="/login">{t("signInLink")}</Link>
        </p>

        <div className="auth-divider">
          <span>{t("orDivider")}</span>
        </div>

        <a
          href="/auth/oidc/login"
          className="button secondary auth-button"
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
            aria-label={t("common:a11y.secureIcon")}
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

      <footer className="register-footer">
        <span>AgentForge v0.1.0</span>
      </footer>
    </main>
  );
}
