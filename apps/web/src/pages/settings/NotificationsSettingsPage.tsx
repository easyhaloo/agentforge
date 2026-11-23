import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOutletContext } from "react-router-dom";
import { Button } from "../../shared/ui/components";
import { Checkbox } from "../../shared/ui/components/form-controls";
import { settingsAPI, type NotificationPreferences } from "../../shared/api/settings";
import { translateError } from "../../shared/api/errors";
import type { SettingsOutletContext } from "./SettingsLayout";

import "./preferences-settings.css";

const inboxOptions = [
  ["inbox_participating", "participating"],
  ["inbox_watching", "watching"],
] as const;

export function NotificationsSettingsPage() {
  const { t } = useTranslation("settings");
  const { notify } = useOutletContext<SettingsOutletContext>();
  const [preferences, setPreferences] = useState<NotificationPreferences>();
  const [retry, setRetry] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void settingsAPI.getNotificationPreferences().then(data => {
      if (active) setPreferences(data);
    }).catch(() => {
      if (active) setLoadFailed(true);
    });
    return () => { active = false; };
  }, [retry]);

  const update = async (key: keyof NotificationPreferences, checked: boolean) => {
    if (saving) return;
    setSaving(true);
    try {
      setPreferences(await settingsAPI.updateNotificationPreferences({ [key]: checked }));
      notify(t("notifications.saveSuccess"));
    } catch (error) {
      notify(translateError(error, t, "settings:errors.saveNotificationsFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-page preferences-settings">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("notifications.title")}</h1>
        <p className="settings-page-description">{t("notifications.description")}</p>
      </header>
      {loadFailed ? <div>
        <p className="preference-error" role="alert">{t("notifications.loadError")}</p>
        <Button onClick={() => { setLoadFailed(false); setRetry(value => value + 1); }}>{t("common:actions.retry")}</Button>
      </div> : !preferences ? <p role="status">{t("common:status.loading")}</p> : <div className="settings-stack">
        {inboxOptions.map(([key, section]) => (
          <fieldset key={key} aria-describedby={`${section}-hint`}>
            <legend className="settings-section-heading">{t(`notifications.${section}.title`)}</legend>
            <p className="settings-note" id={`${section}-hint`}>{t(`notifications.${section}.description`)}</p>
            <div className="settings-box">
              <Checkbox className="settings-box-row preference-checkbox" id={key} name={key}
                label={t(`notifications.${section}.inbox`)} checked={preferences[key]} aria-disabled={saving || undefined}
                onChange={event => void update(key, event.target.checked)} />
            </div>
          </fieldset>
        ))}
        <p className="settings-note">{t("notifications.emailUnavailable")}</p>
        {saving && <p className="settings-note" role="status">{t("common:status.saving")}</p>}
      </div>}
    </div>
  );
}
