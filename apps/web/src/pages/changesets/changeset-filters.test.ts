import { describe, expect, it } from "vitest";
import { CHANGESET_PAGE_SIZE, readChangesetFilters, writeChangesetFilters } from "./changeset-filters";

describe("changeset list filters live in the URL", () => {
  it("reads the filters and the paging the URL carries", () => {
    expect(readChangesetFilters(new URLSearchParams("q=needle&repository=team%2Frepo&status=in_review&reviewer=me&limit=10&offset=30")))
      .toEqual({ q: "needle", repository: "team/repo", status: "in_review", reviewer: "me", limit: 10, offset: 30 });
  });

  it("falls back to the first page and no filter when the URL carries nothing usable", () => {
    expect(readChangesetFilters(new URLSearchParams()))
      .toEqual({ q: "", repository: "", status: "", reviewer: "", limit: CHANGESET_PAGE_SIZE, offset: 0 });
    expect(readChangesetFilters(new URLSearchParams("limit=nonsense&offset=-4")))
      .toMatchObject({ limit: CHANGESET_PAGE_SIZE, offset: 0 });
  });

  it("omits the filters that are empty", () => {
    expect(writeChangesetFilters({ q: "needle", repository: "", status: "", reviewer: "" }, new URLSearchParams()).toString())
      .toBe("q=needle&limit=20&offset=0");
  });

  it("keeps the page size and starts the list again when a filter changes", () => {
    expect(writeChangesetFilters({ status: "merged" }, new URLSearchParams("limit=10&offset=30")).toString())
      .toBe("status=merged&limit=10&offset=0");
  });

  it("keeps the offset when the page changes", () => {
    expect(writeChangesetFilters({ limit: 20, offset: 40 }, new URLSearchParams("limit=20&offset=0")).toString())
      .toBe("limit=20&offset=40");
  });
});
