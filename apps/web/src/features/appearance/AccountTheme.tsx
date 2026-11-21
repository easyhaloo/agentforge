import { createContext, useContext, useEffect, useLayoutEffect, useState, type PropsWithChildren } from "react";
import i18n from "i18next";
import { settingsAPI, type UserPreferences } from "../../shared/api/settings";

type AppearancePreview = Pick<UserPreferences, "theme" | "language">;

const AppearanceContext = createContext({
  saved: null as UserPreferences | null,
  loadError: null as unknown,
  setSaved: (_preferences: UserPreferences) => {},
  preview: (_preferences: AppearancePreview | null) => {},
});

export const useAppearance = () => useContext(AppearanceContext);

/** Each authenticated account owns its request, preview and media listener. */
export function AccountTheme({ children }: PropsWithChildren) {
  const [saved, setSaved] = useState<UserPreferences | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [preview, setPreview] = useState<AppearancePreview | null>(null);
  const theme = preview?.theme ?? saved?.theme ?? "auto";
  const language = preview?.language ?? saved?.language;

  useEffect(() => {
    let active = true;
    settingsAPI.getPreferences().then(
      preferences => { if (active) setSaved(preferences); },
      error => { if (active) setLoadError(error); },
    );
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (language && i18n.resolvedLanguage !== language) void i18n.changeLanguage(language);
  }, [language]);

  useLayoutEffect(() => {
    const media = theme === "auto" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const apply = () => {
      document.documentElement.dataset.theme = media ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media?.addEventListener("change", apply);
    return () => {
      media?.removeEventListener("change", apply);
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);

  return <AppearanceContext.Provider value={{ saved, loadError, setSaved, preview: setPreview }}>{children}</AppearanceContext.Provider>;
}
