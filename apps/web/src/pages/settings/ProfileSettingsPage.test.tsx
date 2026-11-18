import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ProfileSettingsPage } from "./ProfileSettingsPage";

// Mock react-router-dom
vi.mock("react-router-dom", () => ({
  useOutletContext: () => ({
    notify: vi.fn(),
  }),
}));

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProfileSettingsPage", () => {
  const mockProfile = {
    user_id: "user-123",
    username: "testuser",
    display_name: "Test User",
    email: "test@example.com",
    avatar_url: null,
    bio: "Software developer",
    location: "San Francisco, CA",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-15T10:00:00Z",
  };

  it("shows loading state on initial render", () => {
    const html = renderToStaticMarkup(<ProfileSettingsPage />);

    expect(html).toContain("profile.title");
    expect(html).toContain("common:status.loading");
  });

  it("renders profile page structure", () => {
    const html = renderToStaticMarkup(<ProfileSettingsPage />);

    expect(html).toContain("profile.title");
    expect(html).toContain("profile.description");
    expect(html).toContain("settings-page");
  });
});
