import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, afterEach } from "vitest";
import { AccountSettingsPage } from "./AccountSettingsPage";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AccountSettingsPage", () => {
  const mockProfile = {
    user_id: "user-123",
    username: "testuser",
    display_name: "Test User",
    email: "test@example.com",
    avatar_url: null,
    bio: "Developer",
    location: "SF",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-15T10:00:00Z",
  };

  it("shows loading state on initial render", () => {
    const html = renderToStaticMarkup(<AccountSettingsPage />);

    expect(html).toContain("account.title");
    expect(html).toContain("common:status.loading");
  });

  it("renders account page structure", () => {
    const html = renderToStaticMarkup(<AccountSettingsPage />);

    expect(html).toContain("account.title");
    expect(html).toContain("account.description");
    expect(html).toContain("settings-page");
  });
});
