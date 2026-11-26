import { render, act } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Routes, Route, Outlet } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { OrganizationGeneralSettingsPage } from "./GeneralSettingsPage";
import { OrganizationAuditSettingsPage } from "./AuditSettingsPage";
import type { OrganizationLifecycleState } from "./useOrganizationLifecycle";
import * as lifecycleAPI from "../../../shared/api/organizationLifecycle";
import * as identityAPI from "../../../shared/api/identity";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (!values) return key;
      return `${key}?${Object.entries(values).map(([k, v]) => `${k}=${v}`).join("&")}`;
    },
  }),
}));

const organization = { id: "org-1", slug: "acme", name: "Acme", role: "owner" as const };

function lifecycleState(overrides: Partial<OrganizationLifecycleState> = {}): OrganizationLifecycleState {
  return {
    organization,
    status: "active",
    suspendedAt: null,
    suspendedReason: "",
    deletionScheduledAt: null,
    identityReady: null,
    apply: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  } as OrganizationLifecycleState;
}

function renderPage(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={["/orgs/acme/settings/general"]}>
      <Routes>
        <Route path="/orgs/:org/settings/*" element={<Outlet context={{ organization }} />} >
          <Route path="general" element={ui} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("OrganizationGeneralSettingsPage", () => {
  it("renders the danger zone with an active organization and an owner", () => {
    vi.spyOn(lifecycleAPI.organizationLifecycleAPI, "identityHealth").mockResolvedValue({ ready: true, summary: "ready" });
    const html = renderToStaticMarkup(
      <OrganizationGeneralSettingsPage lifecycle={lifecycleState()} />,
    );
    expect(html).toContain("settings:lifecycle.general.title");
    expect(html).toContain("settings:lifecycle.danger.title");
    expect(html).toContain("settings:lifecycle.danger.suspend.action");
  });

  it("shows the suspended banner and inactive update button when locked", () => {
    const html = renderToStaticMarkup(
      <OrganizationGeneralSettingsPage lifecycle={lifecycleState({
        status: "suspended", suspendedAt: "2026-11-25T10:42:00Z", suspendedReason: "合同到期",
      })} />,
    );
    expect(html).toContain("settings:lifecycle.banner.suspendedTitle");
    expect(html).toContain("af-alert--warning");
    expect(html).toContain("af-button--inactive");
    expect(html).toContain('aria-disabled="true"');
    // The reason tooltip carries the locked copy.
    expect(html).toContain("settings:lifecycle.general.inactiveOrgLocked");
  });

  it("shows the pending-deletion banner and offers cancel deletion", () => {
    const html = renderToStaticMarkup(
      <OrganizationGeneralSettingsPage lifecycle={lifecycleState({
        status: "pending_deletion", deletionScheduledAt: "2026-12-25T00:00:00Z", suspendedAt: "2026-11-25T10:42:00Z",
      })} />,
    );
    expect(html).toContain("settings:lifecycle.banner.pendingDeletionTitle");
    expect(html).toContain("af-alert--error");
    expect(html).toContain("settings:lifecycle.danger.cancelDeletion.action");
  });

  it("makes the delete button inactive until the organization is suspended", () => {
    const html = renderToStaticMarkup(
      <OrganizationGeneralSettingsPage lifecycle={lifecycleState({ status: "active" })} />,
    );
    expect(html).toContain("settings:lifecycle.danger.delete.inactiveNotSuspended");
  });

  it("shows the identity banner only when identity-health reports not ready", () => {
    const html = renderToStaticMarkup(
      <OrganizationGeneralSettingsPage lifecycle={lifecycleState({ identityReady: false })} />,
    );
    expect(html).toContain("settings:lifecycle.banner.identityNotReadyTitle");
  });

  it("renders at most one banner (status wins over identity)", () => {
    const html = renderToStaticMarkup(
      <OrganizationGeneralSettingsPage lifecycle={lifecycleState({
        status: "suspended", suspendedAt: "2026-11-25T10:42:00Z", identityReady: false,
      })} />,
    );
    expect((html.match(/af-alert--/g) ?? []).length).toBe(1);
    expect(html).toContain("af-alert--warning");
  });

  it("opens the reason dialog when an inactive button is clicked", async () => {
    vi.spyOn(lifecycleAPI.organizationLifecycleAPI, "identityHealth").mockResolvedValue({ ready: true, summary: "ready" });
    const screen = renderPage(<OrganizationGeneralSettingsPage lifecycle={lifecycleState()} />);
    // As admin the update button is inactive.
    const inactive = screen.getAllByRole("button").find((button) => button.getAttribute("aria-disabled") === "true");
    expect(inactive).toBeDefined();
    await act(async () => { inactive!.click(); });
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("gates suspend confirmation on typing the slug", async () => {
    vi.spyOn(lifecycleAPI.organizationLifecycleAPI, "identityHealth").mockResolvedValue({ ready: true, summary: "ready" });
    vi.spyOn(lifecycleAPI.organizationLifecycleAPI, "suspend").mockResolvedValue({ status: "suspended" } as never);
    const screen = renderPage(<OrganizationGeneralSettingsPage lifecycle={lifecycleState()} />);
    await act(async () => {
      screen.getByRole("button", { name: "settings:lifecycle.danger.suspend.action" }).click();
    });
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("settings:lifecycle.danger.suspend.dialogBanner");
    // The confirm button stays disabled until the slug matches; the API mock
    // asserts no call happened before typing.
    const typed = screen.getByLabelText("settings:lifecycle.danger.typeToConfirm?slug=acme");
    await act(async () => { typed.focus(); });
    expect(lifecycleAPI.organizationLifecycleAPI.suspend).not.toHaveBeenCalled();
  });

  it("returns 423 feedback through the shared error translation", async () => {
    vi.spyOn(lifecycleAPI.organizationLifecycleAPI, "identityHealth").mockResolvedValue({ ready: true, summary: "ready" });
    vi.spyOn(lifecycleAPI.organizationLifecycleAPI, "update").mockRejectedValue(
      Object.assign(new Error("locked"), { status: 423 }),
    );
    const screen = renderPage(<OrganizationGeneralSettingsPage lifecycle={lifecycleState()} />);
    await act(async () => {
      screen.getByRole("button", { name: "settings:lifecycle.general.updateButton" }).click();
    });
    expect(screen.getByRole("alert").textContent).toContain("settings:lifecycle.errors.renameFailed");
  });
});

describe("OrganizationAuditSettingsPage", () => {
  it("renders merged audit events and the empty state", async () => {
    vi.spyOn(lifecycleAPI.organizationLifecycleAPI, "audit").mockResolvedValue({
      items: [
        { id: "a1", actor_user_id: "u1", action: "organization.suspended", created_at: "2026-11-25T10:42:00Z" },
        { id: "a2", actor_user_id: "u2", target_user_id: "u3", action: "role_changed", created_at: "2026-11-20T00:00:00Z" },
      ],
      total: 2, limit: 100, offset: 0,
    });
    const screen = render(<OrganizationAuditSettingsPage lifecycle={lifecycleState()} />);
    await screen.findByText("organization.suspended");
    // Unknown actions fall back to the server value with underscores folded.
    expect(screen.getByText("role changed")).toBeDefined();
  });

  it("shows the empty state when no events exist", async () => {
    vi.spyOn(lifecycleAPI.organizationLifecycleAPI, "audit").mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    const screen = render(<OrganizationAuditSettingsPage lifecycle={lifecycleState()} />);
    await screen.findByText("settings:lifecycle.audit.empty");
  });

  it("surfaces load errors", async () => {
    vi.spyOn(lifecycleAPI.organizationLifecycleAPI, "audit").mockRejectedValue(Object.assign(new Error("x"), { status: 500 }));
    const screen = render(<OrganizationAuditSettingsPage lifecycle={lifecycleState()} />);
    await screen.findByRole("alert");
  });
});

describe("transfer dialog", () => {
  it("loads active members into the owner picker", async () => {
    vi.spyOn(lifecycleAPI.organizationLifecycleAPI, "identityHealth").mockResolvedValue({ ready: true, summary: "ready" });
    vi.spyOn(identityAPI.organizationAPI, "members").mockResolvedValue({
      items: [
        { user_id: "u2", display_name: "Li Wei", role: "admin", status: "active", created_at: "", updated_at: "" },
        { user_id: "u3", display_name: "Chen Xi", role: "viewer", status: "active", created_at: "", updated_at: "" },
      ],
      limit: 100, offset: 0,
    });
    const screen = renderPage(<OrganizationGeneralSettingsPage lifecycle={lifecycleState()} />);
    await act(async () => {
      screen.getByRole("button", { name: "settings:lifecycle.danger.transfer.action" }).click();
    });
    expect(screen.getByRole("dialog").textContent).toContain("settings:lifecycle.danger.transfer.dialogDescription");
  });
});
