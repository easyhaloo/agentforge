import { createContext, useContext, useEffect, useLayoutEffect, useState, type PropsWithChildren } from "react";
import { settingsAPI, type UserPreferences } from "../../shared/api/settings";

const AppearanceContext = createContext({
  saved: null as UserPreferences | null,
  loadError: null as unknown,
  setSaved: (_preferences: UserPreferences) => {},
  preview: (_theme: UserPreferences["theme"] | null) => {},
});

export const useAppearance = () => useContext(AppearanceContext);

/** Each authenticated account owns its request, preview and media listener. */
export function AccountTheme({ children }: PropsWithChildren) {
  const [saved, setSaved] = useState<UserPreferences | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [preview, setPreview] = useState<UserPreferences["theme"] | null>(null);
  const theme = preview ?? saved?.theme ?? "auto";

  useEffect(() => {
    let active = true;
    settingsAPI.getPreferences().then(
      preferences => { if (active) setSaved(preferences); },
      error => { if (active) setLoadError(error); },
    );
    return () => { active = false; };
  }, []);

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
