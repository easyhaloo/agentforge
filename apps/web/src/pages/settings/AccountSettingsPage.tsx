import { useEffect, useState } from "react";
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

  if (loading) {
    return (
      <div className="settings-page">
        <header className="settings-page-header">
          <h1 className="settings-page-title">{t("account.title")}</h1>
          <p className="settings-page-description">{t("account.description")}</p>
        </header>
        <div className="settings-placeholder">
          {t("common:status.loading", { ns: "common" })}
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="settings-page">
        <header className="settings-page-header">
          <h1 className="settings-page-title">{t("account.title")}</h1>
          <p className="settings-page-description">{t("account.description")}</p>
        </header>
        <div className="settings-placeholder" style={{ color: "var(--color-error)" }}>
          {error || t("errors.loadAccountFailed")}
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("account.title")}</h1>
        <p className="settings-page-description">{t("account.description")}</p>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        {/* Account Information Section */}
        <section>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Username */}
            <div className="settings-field-readonly">
              <label className="settings-field-readonly-label">{t("account.username")}</label>
              <div className="settings-field-readonly-value">{profile.username}</div>
            </div>

            {/* Email */}
            <div className="settings-field-readonly">
              <label className="settings-field-readonly-label">{t("account.email")}</label>
              <div className="settings-field-readonly-value">{profile.email}</div>
              <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>
                {t("account.emailDescription")}
              </div>
            </div>

            {/* Account Created */}
            <div className="settings-field-readonly">
              <label className="settings-field-readonly-label">{t("account.createdAt")}</label>
              <div className="settings-field-readonly-value">{formatDateTime(profile.created_at)}</div>
            </div>

            {/* Account Type */}
            <div className="settings-field-readonly">
              <label className="settings-field-readonly-label">{t("account.accountType")}</label>
              <div className="settings-field-readonly-value">
                {t("account.provider")}
                <div style={{ fontSize: "14px", color: "var(--color-text-secondary)", marginTop: "4px" }}>
                  {t("account.accountTypeDesc")}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
