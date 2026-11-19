import { render, screen, fireEvent, within } from "@testing-library/react";
import { settingsAPI } from "../../shared/api/settings";
import { identityManagementAPI } from "../../shared/api/identities";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, afterEach } from "vitest";
import { AuthenticationSettingsPage } from "./AuthenticationSettingsPage";

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
  it("lets a local account change its password", async () => {
    vi.spyOn(settingsAPI, "getAuthenticationInfo").mockResolvedValue({ ...mockAuthInfo, oidc_provider: "platform:internal", oidc_provider_url: "", last_login_at: "" });
    const change = vi.spyOn(identityManagementAPI, "changePassword").mockResolvedValue(undefined);
    render(<AuthenticationSettingsPage />);
    await screen.findByRole("heading", { name: "authentication.localAccount" });
    expect(screen.queryByText("authentication.providerNote")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("authentication.lastLogin")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "authentication.changePassword" }));
    const dialog = within(screen.getByRole("dialog"));
    for (const [field, value] of [["currentPassword", "old-value"], ["newPassword", "new-value"], ["confirmPassword", "new-value"]]) {
      fireEvent.change(dialog.getByLabelText(`authentication.${field}`, { exact: false, selector: "input" }), { target: { value } });
    }
    fireEvent.click(dialog.getByRole("button", { name: "authentication.changePassword" }));
    await screen.findByRole("status");
    expect(change).toHaveBeenCalledWith("old-value", "new-value");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each(["https://sso.example.com", "", "javascript:void(0)"])("only links to a usable external provider (%s)", async (url) => {
    vi.spyOn(settingsAPI, "getAuthenticationInfo").mockResolvedValue({ ...mockAuthInfo, oidc_provider_url: url });
    render(<AuthenticationSettingsPage />);
    await screen.findByText(mockAuthInfo.oidc_provider);
    expect(screen.queryByRole("button", { name: "authentication.changePassword" })).toBeNull();
    expect(screen.queryByRole("link")?.getAttribute("href")).toBe(url.startsWith("https:") ? url : undefined);
  });
});
