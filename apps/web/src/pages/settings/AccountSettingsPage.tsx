import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { settingsAPI, type UserProfile } from "../../shared/api/settings";
import { translateError } from "../../shared/api/errors";
import { formatDateTime } from "../../shared/i18n/format";

export function AccountSettingsPage() {
  const { t } = useTranslation("settings");

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load profile on mount
  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      try {
        setLoading(true);
        setError(null);
        const data = await settingsAPI.getProfile();
        if (mounted) {
          setProfile(data);
        }
      } catch (err) {
        if (mounted) {
          setError(translateError(err, t, "settings:errors.loadAccountFailed"));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("account.title")}</h1>
        <p className="settings-page-description">{t("account.description")}</p>
      </header>
      {loading ? (
        <div className="settings-placeholder" role="status">{t("common:status.loading")}</div>
      ) : error || !profile ? (
        <div className="settings-placeholder" role="alert">{error || t("errors.loadAccountFailed")}</div>
      ) : (
        <div className="settings-stack">
          <section>
            <h2 className="settings-section-heading">{t("profile.displayName")}</h2>
            <div className="settings-account-name">
              <strong>{profile.display_name}</strong>
              <Link className="settings-action-link" to="/settings/profile">{t("account.editProfile")}</Link>
            </div>
          </section>
          <section>
            <h2 className="settings-section-heading">{t("account.details")}</h2>
            <dl className="settings-box settings-account-details">
              {profile.username && (
                <div className="settings-box-row"><dt>{t("account.username")}</dt><dd>{profile.username}</dd></div>
              )}
              <div className="settings-box-row">
                <dt>{t("account.email")}</dt>
                <dd>{profile.email}<small className="settings-note">{t("account.emailDescription")}</small></dd>
              </div>
              <div className="settings-box-row">
                <dt>{t("account.createdAt")}</dt>
                <dd><time dateTime={profile.created_at}>{formatDateTime(profile.created_at)}</time></dd>
              </div>
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}
