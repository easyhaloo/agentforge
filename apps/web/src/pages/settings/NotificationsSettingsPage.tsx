import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOutletContext } from "react-router-dom";
import { Button, Input } from "../../shared/ui/components";
import { Checkbox } from "../../shared/ui/components/form-controls";
import { settingsAPI, type NotificationPreferences, type NotificationEmailSettings } from "../../shared/api/settings";
import { APIError, translateError } from "../../shared/api/errors";
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

  const [email, setEmail] = useState<NotificationEmailSettings>();
  const [emailLoading, setEmailLoading] = useState(true);
  const [emailRetry, setEmailRetry] = useState(0);
  const [emailError, setEmailError] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void settingsAPI.getNotificationEmail(controller.signal).then(data => {
      if (!controller.signal.aborted) setEmail(data);
    }).catch(() => {
      if (!controller.signal.aborted) setEmailError(t("notifications.emailLoadError"));
    }).finally(() => {
      if (!controller.signal.aborted) setEmailLoading(false);
    });
    return () => controller.abort();
  }, [emailRetry, t]);

  const saveEmail = async (action: "request" | "verify" | "preference", save: () => Promise<NotificationEmailSettings>) => {
    if (emailSaving) return;
    setEmailSaving(true);
    setEmailError("");
    try {
      setEmail(await save());
      if (action === "request") { setNewAddress(""); setCode(""); }
      if (action === "verify") setCode("");
      notify(t(action === "request" ? "notifications.emailQueued" : "notifications.saveSuccess"));
    } catch (cause) {
      const key = cause instanceof APIError && cause.status === 429 ? "notifications.emailRateLimit"
        : cause instanceof APIError && cause.status === 422 && action === "verify" ? "notifications.emailInvalidCode"
        : "notifications.emailSaveError";
      setEmailError(t(key));
    } finally {
      setEmailSaving(false);
    }
  };

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
        <section aria-labelledby="notification-email-heading">
          <h2 id="notification-email-heading" className="settings-section-heading">{t("notifications.emailTitle")}</h2>
          {emailLoading ? <p role="status">{t("common:status.loading")}</p>
            : !email ? <>
              <p role="alert" className="preference-error">{emailError}</p>
              <Button onClick={() => { setEmailLoading(true); setEmailRetry(value => value + 1); }}>{t("common:actions.retry")}</Button>
            </> : !email.available ? <p className="settings-note">{t("notifications.emailUnavailable")}</p>
            : <>
              <p className="settings-note">{t(email.address ? "notifications.emailCurrent" : "notifications.emailSetup", { address: email.address })}</p>
              <form className="notification-email-form" onSubmit={event => { event.preventDefault(); void saveEmail("request", () => settingsAPI.requestNotificationEmail(newAddress)); }}>
                <Input type="email" label={t("notifications.emailAddress")} autoComplete="email" value={newAddress} maxLength={254} required
                  onChange={event => setNewAddress(event.target.value)} />
                <Button type="submit" variant={email.pending_address ? "secondary" : "primary"} disabled={emailSaving}>{t("notifications.emailRequest")}</Button>
              </form>
              {email.pending_address && <>
                <p className="settings-note">{t("notifications.emailPending", { address: email.pending_address })}</p>
                <form className="notification-email-form" onSubmit={event => { event.preventDefault(); void saveEmail("verify", () => settingsAPI.verifyNotificationEmail(code)); }}>
                  <Input label={t("notifications.emailCode")} autoComplete="one-time-code" value={code} required
                    onChange={event => setCode(event.target.value)} />
                  <Button type="submit" variant="primary" disabled={emailSaving}>{t("notifications.emailVerify")}</Button>
                </form>
              </>}
              {emailError && <p role="alert" className="preference-error">{emailError}</p>}
            </>}
        </section>
        {inboxOptions.map(([key, section]) => (
          <fieldset key={key} aria-describedby={`${section}-hint`}>
            <legend className="settings-section-heading">{t(`notifications.${section}.title`)}</legend>
            <p className="settings-note" id={`${section}-hint`}>{t(`notifications.${section}.description`)}</p>
            <div className="settings-box">
              <Checkbox className="settings-box-row preference-checkbox" id={key} name={key}
                label={t(`notifications.${section}.inbox`)} checked={preferences[key]} aria-disabled={saving || undefined}
                onChange={event => void update(key, event.target.checked)} />
              {email?.available && <Checkbox className="settings-box-row preference-checkbox" id={`email-${section}`}
                label={t(`notifications.${section}.email`)} checked={email[section]} disabled={!email.address || emailSaving}
                onChange={event => {
                  const checked = event.target.checked;
                  void saveEmail("preference", () => settingsAPI.updateNotificationEmail({ [section]: checked }));
                }} />}
            </div>
          </fieldset>
        ))}
        {saving && <p className="settings-note" role="status">{t("common:status.saving")}</p>}
      </div>}
    </div>
  );
}
