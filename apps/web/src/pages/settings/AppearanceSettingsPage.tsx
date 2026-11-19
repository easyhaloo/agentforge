import { useEffect, useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "i18next";
import { useOutletContext } from "react-router-dom";
import { Button, Select } from "../../shared/ui/components";
import { Radio } from "../../shared/ui/components/form-controls";
import { settingsAPI, type UserPreferences } from "../../shared/api/settings";
import { useAppearance } from "../../features/appearance/AccountTheme";
import { translateError } from "../../shared/api/errors";
import type { SettingsOutletContext } from "./SettingsLayout";

import "./preferences-settings.css";

// Common timezones for the select dropdown
const COMMON_TIMEZONES = [
  { label: "UTC", value: "UTC" },
  { label: "America/New_York (EST/EDT)", value: "America/New_York" },
  { label: "America/Los_Angeles (PST/PDT)", value: "America/Los_Angeles" },
  { label: "America/Chicago (CST/CDT)", value: "America/Chicago" },
  { label: "Europe/London (GMT/BST)", value: "Europe/London" },
  { label: "Europe/Paris (CET/CEST)", value: "Europe/Paris" },
  { label: "Asia/Shanghai (CST)", value: "Asia/Shanghai" },
  { label: "Asia/Tokyo (JST)", value: "Asia/Tokyo" },
  { label: "Asia/Singapore (SGT)", value: "Asia/Singapore" },
  { label: "Australia/Sydney (AEST/AEDT)", value: "Australia/Sydney" },
];

function ThemePreview({ dark = false }: { dark?: boolean }) {
  return (
    <svg className={dark ? "preview-dark" : undefined} viewBox="0 0 180 84" aria-hidden="true" focusable="false">
      <rect width="180" height="84" fill="var(--preview-canvas)" />
      <rect x="12" y="9" width="156" height="75" rx="4" fill="var(--preview-surface)" stroke="var(--preview-line)" />
      <path d="M12 23h156M54 23v61" stroke="var(--preview-line)" />
      <circle cx="22" cy="16" r="3" fill="var(--preview-ink)" />
      <path d="M30 16h25M20 43h23m-23 8h17m46 3h45m-45 12h32" stroke="var(--preview-line)" strokeWidth="3" />
      <path d="M20 34h23M65 32h45" stroke="var(--preview-ink)" strokeWidth="4" />
      <rect x="64" y="43" width="93" height="32" rx="3" fill="none" stroke="var(--preview-line)" />
      <path d="M72 54h5m-5 12h5" stroke="var(--preview-accent)" strokeWidth="4" />
    </svg>
  );
}

export function AppearanceSettingsPage() {
  const { t } = useTranslation("settings");
  const { notify } = useOutletContext<SettingsOutletContext>();

  const { saved, loadError, setSaved, preview } = useAppearance();
  const [draft, setDraft] = useState<UserPreferences | null>(null);
  const preferences = draft ?? saved;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const error = saveError ?? (loadError ? translateError(loadError, t, "settings:errors.loadPreferencesFailed") : null);

  useLayoutEffect(() => {
    preview(draft?.theme ?? null);
    return () => preview(null);
  }, [draft?.theme, preview]);

  useEffect(() => {
    if (saved && i18n.language !== saved.language) void i18n.changeLanguage(saved.language);
  }, [saved]);

  const handleThemeChange = (theme: UserPreferences["theme"]) => {
    if (!preferences) return;

    setDraft({ ...preferences, theme });
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!preferences) return;

    const language = e.target.value as UserPreferences["language"];
    setDraft({ ...preferences, language });

    // Apply language immediately
    i18n.changeLanguage(language);
  };

  const handleTimezoneChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!preferences) return;

    setDraft({ ...preferences, timezone: e.target.value });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preferences || saving) return;

    setSaving(true);
    setSaveError(null);

    try {
      const updated = await settingsAPI.updatePreferences({
        theme: preferences.theme,
        language: preferences.language,
        timezone: preferences.timezone,
      });
      setSaved(updated);
      setDraft(null);
      notify(t("appearance.saveSuccess"));
    } catch (err) {
      setSaveError(translateError(err, t, "settings:errors.savePreferencesFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (!preferences && !error) {
    return (
      <div className="settings-page preferences-settings">
        <header className="settings-page-header">
          <h1 className="settings-page-title">{t("appearance.title")}</h1>
          <p className="settings-page-description">{t("appearance.description")}</p>
        </header>
        <div className="settings-placeholder">
          {t("common:status.loading", { ns: "common" })}
        </div>
      </div>
    );
  }

  if (error && !preferences) {
    return (
      <div className="settings-page preferences-settings">
        <header className="settings-page-header">
          <h1 className="settings-page-title">{t("appearance.title")}</h1>
          <p className="settings-page-description">{t("appearance.description")}</p>
        </header>
        <div className="settings-placeholder" role="alert">
          {error}
        </div>
      </div>
    );
  }

  if (!preferences) return null;

  const themeOptions = [
    { label: t("appearance.themeLight"), value: "light" },
    { label: t("appearance.themeDark"), value: "dark" },
    { label: t("appearance.themeAuto"), value: "auto" },
  ] as const;

  const languageOptions = [
    { label: t("appearance.languageEN"), value: "en-US" },
    { label: t("appearance.languageZH"), value: "zh-CN" },
  ];

  return (
    <div className="settings-page preferences-settings">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("appearance.title")}</h1>
        <p className="settings-page-description">{t("appearance.description")}</p>
      </header>

      <form className="settings-stack" onSubmit={handleSave}>
        {error && <div className="preference-error" role="alert">{error}</div>}
        <fieldset aria-describedby="theme-hint">
          <legend className="settings-section-heading">{t("appearance.theme")}</legend>
          <p className="settings-note" id="theme-hint">{t("appearance.themeDescription")}</p>
          <div className="theme-cards">
            {themeOptions.map(({ label, value }) => (
              <label key={value} className="theme-card">
                <span className="theme-preview">
                  <ThemePreview dark={value === "dark"} />
                  {value === "auto" && <ThemePreview dark />}
                </span>
                <span className="theme-caption">
                  <Radio name="theme" value={value} checked={preferences.theme === value}
                    onChange={() => handleThemeChange(value)} />
                  {label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="settings-box">
          <div className="settings-box-row">
            <Select
              label={t("appearance.language")}
              hint={t("appearance.languageDescription")}
              name="language"
              value={preferences.language}
              options={languageOptions}
              onChange={handleLanguageChange}
            />
          </div>
          <div className="settings-box-row">
            <Select
              label={t("appearance.timezone")}
              hint={t("appearance.timezoneDescription")}
              name="timezone"
              value={preferences.timezone}
              options={COMMON_TIMEZONES}
              onChange={handleTimezoneChange}
            />
          </div>
        </div>

        <Button type="submit" variant="primary" disabled={!draft || saving} loading={saving}>
          {saving ? t("common:status.saving", { ns: "common" }) : t("common:actions.save", { ns: "common" })}
        </Button>
      </form>
    </div>
  );
}
