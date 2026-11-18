import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOutletContext } from "react-router-dom";
import { Button, Select } from "../../shared/ui/components";
import { RadioGroup } from "../../shared/ui/components/form-controls";
import { settingsAPI, type UserPreferences } from "../../shared/api/settings";
import type { SettingsOutletContext } from "./SettingsLayout";

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

/**
 * Apply theme to the document immediately (before saving)
 */
function applyTheme(theme: UserPreferences["theme"]) {
  if (theme === "auto") {
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", isDark);
  } else {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }
}

export function AppearanceSettingsPage() {
  const { t, i18n } = useTranslation("settings");
  const { notify } = useOutletContext<SettingsOutletContext>();

  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track if form has been modified
  const [isDirty, setIsDirty] = useState(false);

  // Load preferences on mount
  useEffect(() => {
    let mounted = true;

    async function loadPreferences() {
      try {
        setLoading(true);
        setError(null);
        const data = await settingsAPI.getPreferences();
        if (mounted) {
          setPreferences(data);
          // Apply loaded theme and language
          applyTheme(data.theme);
          if (i18n.language !== data.language) {
            i18n.changeLanguage(data.language);
          }
        }
      } catch (err) {
        if (mounted) {
          const message = err instanceof Error ? err.message : "Failed to load preferences";
          setError(message);
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
  }, [i18n]);

  const handleThemeChange = (theme: UserPreferences["theme"]) => {
    if (!preferences) return;

    setPreferences({ ...preferences, theme });
    setIsDirty(true);

    // Apply theme immediately for instant preview
    applyTheme(theme);
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!preferences) return;

    const language = e.target.value as UserPreferences["language"];
    setPreferences({ ...preferences, language });
    setIsDirty(true);

    // Apply language immediately
    i18n.changeLanguage(language);
  };

  const handleTimezoneChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!preferences) return;

    setPreferences({ ...preferences, timezone: e.target.value });
    setIsDirty(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preferences || saving) return;

    setSaving(true);
    setError(null);

    try {
      const updated = await settingsAPI.updatePreferences({
        theme: preferences.theme,
        language: preferences.language,
        timezone: preferences.timezone,
      });
      setPreferences(updated);
      setIsDirty(false);
      notify(t("appearance.saveSuccess"));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save preferences";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-page">
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
      <div className="settings-page">
        <header className="settings-page-header">
          <h1 className="settings-page-title">{t("appearance.title")}</h1>
          <p className="settings-page-description">{t("appearance.description")}</p>
        </header>
        <div className="settings-placeholder" style={{ color: "var(--color-error)" }}>
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
  ];

  const languageOptions = [
    { label: t("appearance.languageEN"), value: "en-US" },
    { label: t("appearance.languageZH"), value: "zh-CN" },
  ];

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("appearance.title")}</h1>
        <p className="settings-page-description">{t("appearance.description")}</p>
      </header>

      <form onSubmit={handleSave}>
        {error && (
          <div style={{ padding: "12px", marginBottom: "24px", backgroundColor: "var(--color-error-bg)", color: "var(--color-error)", borderRadius: "6px" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Theme Selection */}
          <RadioGroup
            label={t("appearance.theme")}
            name="theme"
            value={preferences.theme}
            options={themeOptions}
            onChange={(value: string) => handleThemeChange(value as UserPreferences["theme"])}
          />

          {/* Language Selection */}
          <Select
            label={t("appearance.language")}
            name="language"
            value={preferences.language}
            options={languageOptions}
            onChange={handleLanguageChange}
          />

          {/* Timezone Selection */}
          <Select
            label={t("appearance.timezone")}
            name="timezone"
            value={preferences.timezone}
            options={COMMON_TIMEZONES}
            onChange={handleTimezoneChange}
          />

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
