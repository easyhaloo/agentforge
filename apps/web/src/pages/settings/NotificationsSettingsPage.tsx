import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOutletContext } from "react-router-dom";
import { Button } from "../../shared/ui/components";
import { Checkbox, Radio } from "../../shared/ui/components/form-controls";
import { settingsAPI, type NotificationPreferences } from "../../shared/api/settings";
import { translateError } from "../../shared/api/errors";
import type { SettingsOutletContext } from "./SettingsLayout";

import "./preferences-settings.css";

const emailOptions = [
  ["email-evaluation", "evaluation_complete", "notifications.evaluationComplete"],
  ["email-review", "review_assigned", "notifications.reviewAssigned"],
  ["email-changeset", "changeset_status", "notifications.changesetStatus"],
  ["email-org", "org_invitation", "notifications.orgInvitation"],
] as const;

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
      } catch {
        if (mounted) setPreferences(null);
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
  }, []);

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
      notify(translateError(err, t, "settings:errors.saveNotificationsFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-page preferences-settings">
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
      <div className="settings-page preferences-settings">
        <header className="settings-page-header">
          <h1 className="settings-page-title">{t("notifications.title")}</h1>
          <p className="settings-page-description">{t("notifications.description")}</p>
        </header>
        <div className="settings-placeholder" role="alert">
          {t("notifications.loadError")}
        </div>
      </div>
    );
  }

  const frequencyOptions = [
    { label: t("notifications.frequencyRealTime"), value: "real-time" },
    { label: t("notifications.frequencyHourly"), value: "hourly" },
    { label: t("notifications.frequencyDaily"), value: "daily" },
  ] as const;

  return (
    <div className="settings-page preferences-settings">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("notifications.title")}</h1>
        <p className="settings-page-description">{t("notifications.description")}</p>
      </header>

      <form className="settings-stack" onSubmit={handleSubmit}>
        <fieldset aria-describedby="email-hint">
          <legend className="settings-section-heading">{t("notifications.emailTitle")}</legend>
          <p className="settings-note" id="email-hint">{t("notifications.emailDescription")}</p>
          <div className="settings-box">
            {emailOptions.map(([id, key, label]) => (
              <Checkbox
                key={key}
                className="settings-box-row preference-checkbox"
                id={id} name={id} label={t(label)} checked={preferences.email_notifications[key]}
                onChange={e => handleEmailToggle(key, e.target.checked)}
              />
            ))}
          </div>
        </fieldset>

        <fieldset aria-describedby="web-push-hint">
          <legend className="settings-section-heading">{t("notifications.webPushTitle")}</legend>
          <p className="settings-note" id="web-push-hint">{t("notifications.webPushDescription")}</p>
          <div className="settings-box">
            <Checkbox
              className="settings-box-row preference-checkbox"
              id="web-push" name="web-push" label={t("notifications.webPushEnabled")} checked={preferences.web_push_enabled}
              onChange={e => handleWebPushToggle(e.target.checked)}
            />
          </div>
        </fieldset>

        <fieldset>
          <legend className="settings-section-heading">{t("notifications.frequency")}</legend>
          <div className="settings-box">
            {frequencyOptions.map(({ label, value }) => (
              <label className="settings-box-row preference-row" key={value}>
                <Radio name="notification-frequency" value={value}
                  checked={preferences.notification_frequency === value} onChange={() => handleFrequencyChange(value)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <Button type="submit" variant="primary" disabled={!isDirty || saving} loading={saving}>
          {saving ? t("common:status.saving", { ns: "common" }) : t("common:actions.save", { ns: "common" })}
        </Button>
      </form>
    </div>
  );
}
