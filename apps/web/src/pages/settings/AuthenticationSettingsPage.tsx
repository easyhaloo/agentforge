import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { Button } from "../../shared/ui/components";
import { settingsAPI, type AuthenticationInfo } from "../../shared/api/settings";
import { translateError } from "../../shared/api/errors";
import { useDateFormatting } from "../../shared/i18n/format";
import { ChangePasswordDialog } from "./ChangePasswordDialog";

import "./access-settings.css";

export function AuthenticationSettingsPage() {
  const { t } = useTranslation("settings");
  const { formatDateTime } = useDateFormatting();

  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [authInfo, setAuthInfo] = useState<AuthenticationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

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
          setError(() => err);
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

  const local = authInfo?.oidc_provider === "platform:internal";
  const providerURL = authInfo?.oidc_provider_url ?? "";
  const canManageAtProvider = !local && /^https?:\/\//i.test(providerURL) && URL.canParse(providerURL);

  return (
    <div className="settings-page access-settings">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("authentication.title")}</h1>
        <p className="settings-page-description">{t("authentication.description")}</p>
      </header>
      {loading ? (
        <p className="settings-note" role="status">{t("common:status.loading")}</p>
      ) : !authInfo ? (
        <p role="alert">{translateError(error, t, "settings:errors.loadAuthenticationFailed")}</p>
      ) : (
        <div className="settings-stack">
          <section>
            <div className="settings-section-heading access-toolbar">
              <h2>{t(local ? "authentication.localAccount" : "authentication.oidcInfo")}</h2>
              {local && (
                <Button size="small" onClick={() => { setPasswordChanged(false); setChangingPassword(true); }}>
                  {t("authentication.changePassword")}
                </Button>
              )}
              {canManageAtProvider && (
                <a className="access-link" href={providerURL} target="_blank" rel="noopener noreferrer">
                  {t("authentication.manageAtProvider")} <ExternalLink size={14} aria-hidden="true" />
                </a>
              )}
            </div>
            <dl className="settings-box access-list">
              {!local && (
                <div className="settings-box-row access-fact">
                  <dt>{t("authentication.oidcProvider")}</dt>
                  <dd>{authInfo.oidc_provider} <span className="access-badge">{t("authentication.oidcConnected")}</span></dd>
                </div>
              )}
              <div className="settings-box-row access-fact">
                <dt>{t("authentication.loginEmail")}</dt>
                <dd>{authInfo.login_email}</dd>
              </div>
              {authInfo.last_login_at && (
                <div className="settings-box-row access-fact">
                  <dt>{t("authentication.lastLogin")}</dt>
                  <dd><time dateTime={authInfo.last_login_at}>{formatDateTime(authInfo.last_login_at)}</time></dd>
                </div>
              )}
            </dl>
          </section>
          {local ? (
            <>
              <ChangePasswordDialog
                open={changingPassword}
                onClose={() => setChangingPassword(false)}
                onSuccess={() => { setChangingPassword(false); setPasswordChanged(true); }}
              />
              {passwordChanged && <p role="status">{t("authentication.passwordChanged")}</p>}
            </>
          ) : <p className="settings-note">{t("authentication.providerNote")}</p>}
        </div>
      )}
    </div>
  );
}
