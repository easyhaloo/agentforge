import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, afterEach } from "vitest";
import { SessionsSettingsPage } from "./SessionsSettingsPage";

vi.mock("react-router-dom", () => ({
  useOutletContext: () => ({
    notify: vi.fn(),
  }),
}));

vi.mock("react-i18next", () => ({
  // The date helpers format in the interface language, which reaches the real i18next instance.
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SessionsSettingsPage", () => {
  const mockSessions = [
    {
      session_id: "sess-current",
      device_type: "desktop" as const,
      browser: "Chrome 120",
      os: "macOS 14",
      ip_address: "192.168.1.100",
      location: "San Francisco, US",
      created_at: "2024-01-10T00:00:00Z",
      last_active_at: "2024-01-15T10:00:00Z",
      is_current: true,
    },
    {
      session_id: "sess-2",
      device_type: "mobile" as const,
      browser: "Safari 17",
      os: "iOS 17",
      ip_address: "192.168.1.101",
      location: "New York, US",
      created_at: "2024-01-12T00:00:00Z",
      last_active_at: "2024-01-14T15:30:00Z",
      is_current: false,
    },
    {
      session_id: "sess-3",
      device_type: "tablet" as const,
      browser: "Firefox 121",
      os: "Android 14",
      ip_address: "10.0.0.50",
      location: "London, UK",
      created_at: "2024-01-05T00:00:00Z",
      last_active_at: "2024-01-13T08:00:00Z",
      is_current: false,
    },
  ];

  it("shows loading state on initial render", () => {
    const html = renderToStaticMarkup(<SessionsSettingsPage />);

    expect(html).toContain("sessions.title");
    expect(html).toContain("common:status.loading");
  });

  it("renders sessions page structure", () => {
    const html = renderToStaticMarkup(<SessionsSettingsPage />);

    expect(html).toContain("sessions.title");
    expect(html).toContain("sessions.description");
    expect(html).toContain("settings-page");
  });
});
