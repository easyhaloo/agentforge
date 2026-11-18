import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, afterEach } from "vitest";
import { AuthenticationSettingsPage } from "./AuthenticationSettingsPage";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AuthenticationSettingsPage", () => {
  const mockAuthInfo = {
    oidc_provider: "Corporate SSO",
    oidc_provider_url: "https://sso.example.com",
    login_email: "test@example.com",
    last_login_at: "2024-01-15T10:00:00Z",
  };

  it("shows loading state on initial render", () => {
    const html = renderToStaticMarkup(<AuthenticationSettingsPage />);

    expect(html).toContain("authentication.title");
    expect(html).toContain("common:status.loading");
  });

  it("renders authentication page structure", () => {
    const html = renderToStaticMarkup(<AuthenticationSettingsPage />);

    expect(html).toContain("authentication.title");
    expect(html).toContain("authentication.description");
    expect(html).toContain("settings-page");
  });
});
