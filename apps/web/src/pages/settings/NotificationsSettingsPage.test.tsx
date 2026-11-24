import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, afterEach } from "vitest";
import { NotificationsSettingsPage } from "./NotificationsSettingsPage";

vi.mock("react-router-dom", () => ({
  useOutletContext: () => ({
    notify: vi.fn(),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("NotificationsSettingsPage", () => {
  it("shows loading state on initial render", () => {
    const html = renderToStaticMarkup(<NotificationsSettingsPage />);

    expect(html).toContain("notifications.title");
    expect(html).toContain("common:status.loading");
  });

  it("renders notifications page structure", () => {
    const html = renderToStaticMarkup(<NotificationsSettingsPage />);

    expect(html).toContain("notifications.title");
    expect(html).toContain("notifications.description");
    expect(html).toContain("settings-page");
  });
});
