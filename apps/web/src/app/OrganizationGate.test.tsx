import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";
import type { AccountContext, OrganizationSummary } from "../shared/api/identity";
import i18n from "../locales";
import { AppAccountContext, type AppAccount } from "./account-context";
import { OrganizationGate } from "./OrganizationGate";

beforeAll(async () => {
  await i18n.changeLanguage("en-US");
});

const demo: OrganizationSummary = { id: "org-demo", slug: "demo", name: "AgentForge Demo", role: "owner" };
const labs: OrganizationSummary = { id: "org-labs", slug: "Labs", name: "AgentForge Labs", role: "admin" };
const account: AccountContext = { user_id: "user-owner", display_name: "Taylor Owner", organizations: [demo, labs] };
const ready: AppAccount = {
  account, accountState: "ready", accountError: "", reload: async () => {}, selectedOrganization: demo,
};

function render(state: Partial<AppAccount>, variant: "organization" | "changesets", handle = "demo"): string {
  return renderToStaticMarkup(
    <AppAccountContext.Provider value={{ ...ready, ...state }}>
      <MemoryRouter initialEntries={[`/orgs/${handle}/page`]}>
        <Routes>
          <Route path="/orgs/:org" element={<OrganizationGate variant={variant} />}>
            <Route path="page" element={<p>page content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AppAccountContext.Provider>,
  );
}

const card = (inner: string) => `<section class="card org-auth-state">${inner}</section>`;
const loadingCopy = "Loading authenticated account and organizations…";
const noOrganizations: Partial<AppAccount> = { account: { ...account, organizations: [] }, selectedOrganization: undefined };

describe("OrganizationGate states keep the copy each page had before routing", () => {
  it.each(["organization", "changesets"] as const)("shows the loading state for the %s variant", (variant) => {
    expect(render({ accountState: "loading" }, variant)).toBe(card(loadingCopy));
  });

  it("unavailable: names the service, shows the error and offers Retry", () => {
    const organization = render({ account: null, accountState: "unavailable", accountError: "Network down" }, "organization");
    expect(organization).toContain("<h2>Organization service unavailable</h2><p>Network down</p>");
    expect(organization).toContain(">Retry</button>");
    const changesets = render({ account: null, accountState: "unavailable", accountError: "Network down" }, "changesets");
    expect(changesets).toContain("<h2>Changeset service unavailable</h2><p>Network down</p>");
    expect(changesets).toContain(">Retry</button>");
  });

  it("no organization membership: variant specific explanation", () => {
    expect(render(noOrganizations, "organization", "current")).toBe(card("<h2>No active organization</h2><p>This account has no active organization membership. Ask an organization owner for an invitation.</p>"));
    expect(render(noOrganizations, "changesets", "current")).toBe(card("<h2>No active organization</h2><p>This account has no active organization membership.</p>"));
  });

  it("unknown handle: same heading, and the body names the handle", () => {
    for (const variant of ["organization", "changesets"] as const) {
      expect(render({}, variant, "nope")).toBe(card("<h2>No active organization</h2><p>No organization &quot;nope&quot; is available to this account.</p>"));
    }
  });
});

describe("OrganizationGate organization resolution", () => {
  it.each([["slug", "demo"], ["id", "org-demo"], ["slug with different case", "DEMO"], ["second organization slug", "labs"]])("renders the page for a %s handle", (_name, handle) => {
    expect(render({}, "changesets", handle)).toBe("<p>page content</p>");
  });

  it("does not resolve the current alias as a stored handle; it redirects instead of rendering the page", () => {
    expect(render({}, "changesets", "current")).toBe("");
  });
});
