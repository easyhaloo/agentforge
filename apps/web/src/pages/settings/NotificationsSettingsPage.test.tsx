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
  const mockNotifications = {
    email_notifications: {
      evaluation_complete: true,
      review_assigned: true,
      changeset_status: false,
      org_invitation: true,
    },
    web_push_enabled: false,
    notification_frequency: "real-time" as const,
  };

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
