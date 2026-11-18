import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOutletContext } from "react-router-dom";
import { Button } from "../../shared/ui/components";
import { Checkbox, RadioGroup } from "../../shared/ui/components/form-controls";
import { settingsAPI, type NotificationPreferences } from "../../shared/api/settings";
import type { SettingsOutletContext } from "./SettingsLayout";

export function NotificationsSettingsPage() {
  const { t } = useTranslation("settings");
  const { notify } = useOutletContext<SettingsOutletContext>();

  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Load notification preferences on mount
  useEffect(() => {
    let mounted = true;

    async function loadPreferences() {
      try {
        setLoading(true);
        const data = await settingsAPI.getNotificationPreferences();
        if (mounted) {
          setPreferences(data);
        }
      } catch (err) {
        if (mounted) {
          notify(err instanceof Error ? err.message : "Failed to load notification preferences");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadPreferences();

    return () => {
      mounted = false;
    };
  }, [notify]);

  const handleEmailToggle = (key: keyof NotificationPreferences["email_notifications"], checked: boolean) => {
    if (!preferences) return;

    setPreferences({
      ...preferences,
      email_notifications: {
        ...preferences.email_notifications,
        [key]: checked,
      },
    });
    setIsDirty(true);
  };

  const handleWebPushToggle = (checked: boolean) => {
    if (!preferences) return;

    setPreferences({
      ...preferences,
      web_push_enabled: checked,
    });
    setIsDirty(true);
  };

  const handleFrequencyChange = (frequency: NotificationPreferences["notification_frequency"]) => {
    if (!preferences) return;

    setPreferences({
      ...preferences,
      notification_frequency: frequency,
    });
    setIsDirty(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preferences || saving) return;

    setSaving(true);

    try {
      const updated = await settingsAPI.updateNotificationPreferences(preferences);
      setPreferences(updated);
      setIsDirty(false);
      notify(t("notifications.saveSuccess"));
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save notification preferences");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-page">
        <header className="settings-page-header">
          <h1 className="settings-page-title">{t("notifications.title")}</h1>
          <p className="settings-page-description">{t("notifications.description")}</p>
        </header>
        <div className="settings-placeholder">
          {t("common:status.loading", { ns: "common" })}
        </div>
      </div>
    );
  }

  if (!preferences) {
    return (
      <div className="settings-page">
        <header className="settings-page-header">
          <h1 className="settings-page-title">{t("notifications.title")}</h1>
          <p className="settings-page-description">{t("notifications.description")}</p>
        </header>
        <div className="settings-placeholder" style={{ color: "var(--color-error)" }}>
          Failed to load notification preferences
        </div>
      </div>
    );
  }

  const frequencyOptions = [
    { label: t("notifications.frequencyRealtime"), value: "real-time" },
    { label: t("notifications.frequencyHourly"), value: "hourly" },
    { label: t("notifications.frequencyDaily"), value: "daily" },
  ];

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("notifications.title")}</h1>
        <p className="settings-page-description">{t("notifications.description")}</p>
      </header>

      <form onSubmit={handleSubmit}>
        <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
          {/* Email Notifications Section */}
          <section>
            <h2 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px", color: "var(--color-text-primary)" }}>
              {t("notifications.emailTitle")}
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <Checkbox
                id="email-evaluation"
                name="email-evaluation"
                checked={preferences.email_notifications.evaluation_complete}
                onChange={(e) => handleEmailToggle("evaluation_complete", e.target.checked)}
                label={t("notifications.evaluationComplete")}
              />
              <Checkbox
                id="email-review"
                name="email-review"
                checked={preferences.email_notifications.review_assigned}
                onChange={(e) => handleEmailToggle("review_assigned", e.target.checked)}
                label={t("notifications.reviewAssigned")}
              />
              <Checkbox
                id="email-changeset"
                name="email-changeset"
                checked={preferences.email_notifications.changeset_status}
                onChange={(e) => handleEmailToggle("changeset_status", e.target.checked)}
                label={t("notifications.changesetStatus")}
              />
              <Checkbox
                id="email-org"
                name="email-org"
                checked={preferences.email_notifications.org_invitation}
                onChange={(e) => handleEmailToggle("org_invitation", e.target.checked)}
                label={t("notifications.orgInvitation")}
              />
            </div>
          </section>

          {/* Web Push Notifications Section */}
          <section>
            <h2 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px", color: "var(--color-text-primary)" }}>
              {t("notifications.webPushTitle")}
            </h2>
            <Checkbox
              id="web-push"
              name="web-push"
              checked={preferences.web_push_enabled}
              onChange={(e) => handleWebPushToggle(e.target.checked)}
              label={t("notifications.webPushEnabled")}
            />
          </section>

          {/* Notification Frequency Section */}
          <section>
            <RadioGroup
              label={t("notifications.frequencyTitle")}
              name="notification-frequency"
              value={preferences.notification_frequency}
              options={frequencyOptions}
              onChange={(value: string) => handleFrequencyChange(value as NotificationPreferences["notification_frequency"])}
            />
          </section>

          {/* Save Button */}
          <div style={{ paddingTop: "8px" }}>
            <Button
              type="submit"
              variant="primary"
              disabled={!isDirty || saving}
              loading={saving}
            >
              {saving ? t("common:status.saving", { ns: "common" }) : t("common:actions.save", { ns: "common" })}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
