import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { Button } from "../../shared/ui/components";
import { settingsAPI, type AuthenticationInfo } from "../../shared/api/settings";
import { translateError } from "../../shared/api/errors";
import { formatDateTime } from "../../shared/i18n/format";

export function AuthenticationSettingsPage() {
  const { t } = useTranslation("settings");

  const [authInfo, setAuthInfo] = useState<AuthenticationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load authentication info on mount
  useEffect(() => {
    let mounted = true;

    async function loadAuthInfo() {
      try {
        setLoading(true);
        setError(null);
        const data = await settingsAPI.getAuthenticationInfo();
        if (mounted) {
          setAuthInfo(data);
        }
      } catch (err) {
        if (mounted) {
          setError(translateError(err, t, "settings:errors.loadAuthenticationFailed"));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadAuthInfo();

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="settings-page">
        <header className="settings-page-header">
          <h1 className="settings-page-title">{t("authentication.title")}</h1>
          <p className="settings-page-description">{t("authentication.description")}</p>
        </header>
        <div className="settings-placeholder">
          {t("common:status.loading", { ns: "common" })}
        </div>
      </div>
    );
  }

  if (error || !authInfo) {
    return (
      <div className="settings-page">
        <header className="settings-page-header">
          <h1 className="settings-page-title">{t("authentication.title")}</h1>
          <p className="settings-page-description">{t("authentication.description")}</p>
        </header>
        <div className="settings-placeholder" style={{ color: "var(--color-error)" }}>
          {error || t("errors.loadAuthenticationFailed")}
        </div>
      </div>
    );
  }

  const handleManageAtProvider = () => {
    window.open(authInfo.oidc_provider_url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("authentication.title")}</h1>
        <p className="settings-page-description">{t("authentication.description")}</p>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
        {/* OIDC Authentication Info Section */}
        <section>
          <h2 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px", color: "var(--color-text-primary)" }}>
            {t("authentication.oidcInfo")}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Provider */}
            <div className="settings-field-readonly">
              <label className="settings-field-readonly-label">{t("authentication.oidcProvider")}</label>
              <div className="settings-field-readonly-value">
                {authInfo.oidc_provider}
                <span
                  style={{
                    marginLeft: "8px",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    fontSize: "12px",
                    fontWeight: 500,
                    backgroundColor: "var(--color-primary-bg)",
                    color: "var(--color-primary)",
                  }}
                >
                  {t("authentication.oidcConnected")}
                </span>
              </div>
            </div>

            {/* Login Email */}
            <div className="settings-field-readonly">
              <label className="settings-field-readonly-label">{t("authentication.loginEmail")}</label>
              <div className="settings-field-readonly-value">{authInfo.login_email}</div>
            </div>

            {/* Last Login */}
            <div className="settings-field-readonly">
              <label className="settings-field-readonly-label">{t("authentication.lastLogin")}</label>
              <div className="settings-field-readonly-value">{formatDateTime(authInfo.last_login_at)}</div>
            </div>
          </div>
        </section>

        {/* Manage at Provider Section */}
        <section>
          <Button
            variant="primary"
            onClick={handleManageAtProvider}
            style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
          >
            {t("authentication.manageAtProvider")}
            <ExternalLink size={16} />
          </Button>
          <p style={{
            marginTop: "12px",
            fontSize: "14px",
            color: "var(--color-text-secondary)",
            lineHeight: "1.5"
          }}>
            {t("authentication.providerNote")}
          </p>
        </section>
      </div>
    </div>
  );
}
