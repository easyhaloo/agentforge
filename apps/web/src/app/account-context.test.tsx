import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, Outlet } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MyOrganizationsSettingsPage } from "../pages/settings/MyOrganizationsSettingsPage";
import { AppAccountContext, useSelectedOrganization } from "./account-context";
import type { AccountContext } from "../shared/api/identity";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) => values ? `${key}?${Object.entries(values).map(([k, v]) => `${k}=${v}`).join("&")}` : key }),
}));

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const organizations = [
  { id: "org-a", slug: "acme", name: "Acme", role: "owner" as const, status: "active" as const },
  { id: "org-s", slug: "paused", name: "Paused Co", role: "owner" as const, status: "suspended" as const },
  { id: "org-p", slug: "doomed", name: "Doomed Co", role: "owner" as const, status: "pending_deletion" as const, deletion_scheduled_at: "2026-12-25T00:00:00Z" },
];
const account: AccountContext = { user_id: "u1", display_name: "Owner", organizations };

function renderMyOrgs() {
  return render(
    <MemoryRouter initialEntries={["/settings/organizations"]}>
      <AppAccountContext.Provider value={{ account, accountState: "ready", accountError: "", reload: async () => {}, selectedOrganization: organizations[0] }}>
        <Routes>
          <Route element={<Outlet context={{ organizations, notify: () => {}, reload: async () => {} }} />}>
            <Route path="/settings/organizations" element={<MyOrganizationsSettingsPage />} />
          </Route>
        </Routes>
      </AppAccountContext.Provider>
    </MemoryRouter>,
  );
}

describe("MyOrganizationsSettingsPage", () => {
  it("lists suspended and pending-deletion organizations with status labels", () => {
    renderMyOrgs();
    expect(screen.getByText("Acme")).toBeDefined();
    expect(screen.getByText("settings:statuses.suspended")).toBeDefined();
    expect(screen.getByText("settings:myOrgs.daysRemaining?days=30")).toBeDefined();
    // Cancel-deletion is offered to the owner of the pending organization.
    expect(screen.getAllByRole("button", { name: "settings:myOrgs.cancelDeletion" }).length).toBe(1);
  });
});

describe("default organization selection with non-active organizations", () => {
  function Probe({ source }: { source: AccountContext }) {
    const [selected] = useSelectedOrganization(source);
    return <span data-testid="selected">{selected?.id ?? "none"}</span>;
  }
  const mount = (persisted = "", source: AccountContext = account) => {
    // usePersistentState stores JSON, so the seed must be JSON-encoded too.
    localStorage.setItem("agentforge-organization:u1", JSON.stringify(persisted));
    return render(
      <MemoryRouter>
        <AppAccountContext.Provider value={{ account: source, accountState: "ready", accountError: "", reload: async () => {}, selectedOrganization: source.organizations[0] }}>
          <Probe source={source} />
        </AppAccountContext.Provider>
      </MemoryRouter>,
    );
  };
  it("prefers the persisted choice", () => {
    const screen = mount("org-s");
    expect(screen.getByTestId("selected").textContent).toBe("org-s");
  });
  it("falls back to the first active organization, skipping suspended ones", () => {
    const screen = mount("");
    expect(screen.getByTestId("selected").textContent).toBe("org-a");
  });
  it("falls back to the first organization when none are active", () => {
    const lockedOnly: AccountContext = { user_id: "u1", display_name: "Owner", organizations: [organizations[2], organizations[1]] };
    const screen = mount("", lockedOnly);
    expect(screen.getByTestId("selected").textContent).toBe("org-p");
  });
});
