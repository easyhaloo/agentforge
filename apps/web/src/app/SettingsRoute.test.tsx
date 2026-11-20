import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileSettingsPage } from "../pages/settings/ProfileSettingsPage";
import { KeysSettingsPage } from "../pages/settings/KeysSettingsPage";
import { SessionsSettingsPage } from "../pages/settings/SessionsSettingsPage";
import { settingsAPI } from "../shared/api/settings";
import { NotificationProvider } from "../shared/ui";
import { AppAccountContext } from "./account-context";
import { SettingsRoute } from "./RouteElements";

vi.mock("react-i18next", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-i18next")>(), useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(() => vi.restoreAllMocks());

function openSettings(page: React.ReactElement) {
  return render(
    <MemoryRouter><NotificationProvider>
      <AppAccountContext.Provider value={{ account: { user_id: "id-1", email: "jules@example.test", display_name: "Jules", organizations: [] }, accountState: "ready", accountError: "", reload: async () => {}, selectedOrganization: undefined }}>
        <Routes><Route element={<SettingsRoute />}><Route index element={page} /></Route></Routes>
      </AppAccountContext.Provider>
    </NotificationProvider></MemoryRouter>,
  );
}

describe("settings routes", () => {
  it("shows settings navigation and reports a failed profile read once", async () => {
    const read = vi.spyOn(settingsAPI, "getProfile").mockRejectedValueOnce(new Error("Unavailable"));
    openSettings(<ProfileSettingsPage />);
    expect(screen.getByRole("link", { name: "nav.profile" }).getAttribute("href")).toBe("/settings/profile");
    expect((await screen.findByRole("alert")).textContent).toBe("profile.loadError");
    expect(screen.queryByRole("status")).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each([
    [KeysSettingsPage, "getSSHKeys", "keys.loadError", "keys.noKeys"],
    [SessionsSettingsPage, "getSessions", "sessions.loadError", "sessions.noOtherSessions"],
  ] as const)("distinguishes failed and empty %s reads", async (Page, method, error, empty) => {
    const read = vi.spyOn(settingsAPI, method).mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValueOnce([]);
    openSettings(<Page />);
    expect((await screen.findByRole("alert")).textContent).toBe(error);
    expect(screen.queryByText(empty)).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "common:actions.refresh" }));
    await screen.findByText(empty);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });
});
