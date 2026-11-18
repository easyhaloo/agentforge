import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { OrganizationSummary } from "../../shared/api/identity";
import { ChangesetsPage } from "./ChangesetsPage";

const organization: OrganizationSummary = { id: "org-demo", slug: "demo", name: "AgentForge Demo", role: "owner" };

/** The list page reads its filters from the URL, so the URL alone decides what it shows. */
const renderPage = (entry: string) => renderToStaticMarkup(
  <MemoryRouter initialEntries={[entry]}>
    <ChangesetsPage organization={organization} onNotify={() => {}} />
  </MemoryRouter>,
);

describe("changeset list filters", () => {
  it("reads the search term from the URL", () => {
    expect(renderPage("/orgs/demo/changesets?q=needle")).toContain('value="needle"');
  });

  it("reads the status filter from the URL", () => {
    expect(renderPage("/orgs/demo/changesets?status=in_review")).toContain('<option value="in_review" selected="">');
  });

  it("shows no status filter as selected when the URL carries none", () => {
    expect(renderPage("/orgs/demo/changesets")).toContain('<option value="" selected="">All statuses</option>');
  });
});
