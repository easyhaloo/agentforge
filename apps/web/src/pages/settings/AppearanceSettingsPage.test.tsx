import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, afterEach } from "vitest";
import { AppearanceSettingsPage } from "./AppearanceSettingsPage";

vi.mock("react-router-dom", () => ({
  useOutletContext: () => ({
    notify: vi.fn(),
  }),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-i18next")>(),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: "en-US",
      changeLanguage: vi.fn(),
    },
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AppearanceSettingsPage", () => {
  const mockPreferences = {
    theme: "dark" as const,
    language: "en-US" as const,
    timezone: "America/New_York",
    updated_at: "2024-01-15T10:00:00Z",
  };

  it("shows loading state on initial render", () => {
    const html = renderToStaticMarkup(<AppearanceSettingsPage />);

    expect(html).toContain("appearance.title");
    expect(html).toContain("common:status.loading");
  });

  it("renders appearance page structure", () => {
    const html = renderToStaticMarkup(<AppearanceSettingsPage />);

    expect(html).toContain("appearance.title");
    expect(html).toContain("appearance.description");
    expect(html).toContain("settings-page");
  });
});
