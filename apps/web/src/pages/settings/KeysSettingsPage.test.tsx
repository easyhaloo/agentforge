import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, afterEach } from "vitest";
import { KeysSettingsPage } from "./KeysSettingsPage";

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

describe("KeysSettingsPage", () => {
  const mockKeys = [
    {
      key_id: "key-1",
      title: "Work Laptop",
      key_type: "Ed25519" as const,
      key_bits: 256,
      public_key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample",
      fingerprint: "SHA256:abc123def456",
      created_at: "2024-01-01T00:00:00Z",
      last_used_at: "2024-01-15T10:00:00Z",
    },
    {
      key_id: "key-2",
      title: "Home Desktop",
      key_type: "RSA" as const,
      key_bits: 4096,
      public_key: "ssh-rsa AAAAExampleKey",
      fingerprint: "SHA256:xyz789abc123",
      created_at: "2023-12-01T00:00:00Z",
      last_used_at: null,
    },
  ];

  it("shows loading state on initial render", () => {
    const html = renderToStaticMarkup(<KeysSettingsPage />);

    expect(html).toContain("keys.title");
    expect(html).toContain("common:status.loading");
  });

  it("renders keys page structure", () => {
    const html = renderToStaticMarkup(<KeysSettingsPage />);

    expect(html).toContain("keys.title");
    expect(html).toContain("keys.description");
    expect(html).toContain("settings-page");
  });
});
