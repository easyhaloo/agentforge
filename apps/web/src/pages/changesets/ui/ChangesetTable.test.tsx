import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { StoredChangeset } from "../../../shared/api/identity";
import { ChangesetTable, changesetRows } from "./ChangesetTable";

const stored = (id: string, title: string, status: StoredChangeset["status"] = "draft"): StoredChangeset => ({
  changeset: {
    id, created_by: "user-owner", repository: "team/repo", title,
    revisions: [], evaluations: [], evidence: [], reviews: [], audit: [],
  },
  status, version: 1, created_at: "2026-11-17T09:00:00.000Z", updated_at: "2026-11-17T09:00:00.000Z",
});

const renderTable = (items: StoredChangeset[]) => renderToStaticMarkup(
  <MemoryRouter initialEntries={["/orgs/demo/changesets"]}>
    <ChangesetTable items={items} total={items.length} page={1} pageSize={20} onPageChange={() => {}} onOpen={() => {}} />
  </MemoryRouter>,
);

describe("changeset list table", () => {
  it("shows the rows the server sent", () => {
    const html = renderTable([stored("CS-1", "Server row one"), stored("CS-2", "Server row two")]);
    expect(html).toContain("Server row one");
    expect(html).toContain("Server row two");
    expect(html).toContain("CS-1");
  });

  it("does not filter the rows in the browser: the server decides what a list contains", () => {
    const items = [stored("CS-1", "Row the server sent"), stored("CS-2", "Another row")];
    expect(changesetRows(items)).toHaveLength(items.length);
  });

  it("shows the status the server reports, not one the browser derives", () => {
    // A stored changeset that looks merged, but the server says it is still a draft.
    const item = stored("CS-1", "Server status wins", "draft");
    item.changeset.merge = { id: "m-1", revision_id: "r-1", actor: "user-owner", target_ref: "main", commit_sha: "abc123", created_at: "2026-11-17T09:00:00.000Z" };

    const html = renderTable([item]);

    expect(html).toContain('<span class="status muted">Draft</span>');
    expect(html).not.toContain("Merged");
  });
});
