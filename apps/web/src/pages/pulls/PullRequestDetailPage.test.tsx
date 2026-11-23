import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../locales";
import { APIError, changesetAPI, organizationAPI, repositoryAPI, type OrganizationSummary, type RepositorySettings, type StoredChangeset } from "../../shared/api/identity";
import { pullRequestPath } from "../../shared/routing";
import { PullRequestDetailPage } from "./PullRequestDetailPage";

const org: OrganizationSummary = { id: "org-id", slug: "org", name: "Org", role: "owner" };
const repo = "repository";
const pullNumber = "pull-request";
const timestamp = "2026-11-01T00:00:00Z";
const revision = { id: "revision-1", ref: "feature", commit_sha: "commit-1", created_at: timestamp };
const changeset: StoredChangeset = {
  changeset: {
    id: pullNumber, created_by: "author", repository: repo, title: "Update repository",
    revisions: [revision], evaluations: [], evidence: [], reviews: [], audit: [],
    pull_request: { base_branch: "main", source_branch: "feature", draft: false, closed: false, description: "", comments: [] },
  },
  status: "ready_to_merge", version: 1, created_at: timestamp, updated_at: timestamp,
};
const settings: RepositorySettings = {
  organization_id: org.id, slug: repo, default_branch: "main", hosting_kind: "hosted",
  pull_request_merge_methods: ["merge"], created_by: "author", created_at: timestamp, updated_at: timestamp,
};

function Detail() {
  const { pathname } = useLocation();
  return <PullRequestDetailPage organization={org} repository={repo} handle={org.slug} pullNumber={pullNumber}
    tab={pathname.endsWith("/checks") ? "checks" : "conversation"} userID="reviewer"/>;
}

function renderDetail() {
  return render(<MemoryRouter initialEntries={[pullRequestPath(org.slug, repo, pullNumber)]}><Detail/></MemoryRouter>);
}

const mergeButton = () => screen.getByRole("button", { name: "Merge pull request" });

describe("required repository workflows", () => {
  beforeAll(async () => { await i18n.changeLanguage("en-US"); });
  beforeEach(() => {
    vi.spyOn(changesetAPI, "get").mockResolvedValue(changeset);
    vi.spyOn(changesetAPI, "getComparison").mockRejectedValue(new Error("Unused in these tabs"));
    vi.spyOn(repositoryAPI, "settings").mockResolvedValue(settings);
    vi.spyOn(organizationAPI, "members").mockResolvedValue({ items: [], limit: 20, offset: 0 });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows distinct workflow statuses and enables Merge after the required rule is removed", async () => {
    vi.useFakeTimers();
    const request = vi.spyOn(changesetAPI, "getRequiredWorkflows")
      .mockResolvedValueOnce({ revision_id: revision.id, checks: [
        { pipeline_id: "p1", name: "CI / web", status: "waiting" },
        { pipeline_id: "p2", name: "CI / API", status: "behind" },
        { pipeline_id: "p3", name: "CI / contracts", status: "source_moved" },
        { pipeline_id: "p4", name: "CI / release", status: "passed" },
      ] })
      .mockResolvedValue({ revision_id: revision.id, checks: [] });
    await act(async () => { renderDetail(); });
    expect(mergeButton()).toBeDisabled();
    expect(screen.getByText("Required workflows passed: 1 of 4")).toBeVisible();
    fireEvent.click(screen.getByRole("link", { name: "View checks" }));
    expect(screen.getByRole("heading", { name: "Required repository workflows" })).toBeVisible();
    for (const label of ["CI / web", "Waiting for a passing run", "Source branch is behind the target branch", "Source branch changed since this revision", "Passed"]) {
      expect(screen.getByText(label, { exact: true })).toBeVisible();
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(request).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("heading", { name: "Required repository workflows" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Conversation/ }));
    expect(mergeButton()).toBeEnabled();
  });

  it("blocks Merge through loading, unavailable and stale results and retries against the active revision", async () => {
    let finishInitialRequest: () => void = () => {};
    const request = vi.spyOn(changesetAPI, "getRequiredWorkflows")
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        finishInitialRequest = () => reject(new APIError("Unavailable", 503));
      }))
      .mockResolvedValueOnce({ revision_id: "revision-2", checks: [] })
      .mockResolvedValue({ revision_id: "revision-2", checks: [{ pipeline_id: "p1", name: "CI / web", status: "passed" }] });
    vi.mocked(changesetAPI.get)
      .mockResolvedValueOnce(changeset)
      .mockResolvedValue({ ...changeset, changeset: { ...changeset.changeset, revisions: [revision, { ...revision, id: "revision-2" }] } });
    await act(async () => { renderDetail(); });
    expect(mergeButton()).toBeDisabled();
    await act(async () => { finishInitialRequest(); });
    expect(screen.getByText("Required workflow statuses are unavailable.")).toBeVisible();
    expect(mergeButton()).toBeDisabled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry" })); });
    expect(request.mock.calls[0][2].aborted).toBe(true);
    expect(screen.getByText(/The active revision changed/)).toBeVisible();
    expect(mergeButton()).toBeDisabled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry" })); });
    expect(changesetAPI.get).toHaveBeenCalledTimes(2);
    expect(mergeButton()).toBeEnabled();
  });

  it("allows a registered PR to merge with an empty policy response", async () => {
    vi.mocked(repositoryAPI.settings).mockResolvedValue({ ...settings, hosting_kind: "registered", pull_request_merge_methods: undefined });
    vi.spyOn(changesetAPI, "getRequiredWorkflows").mockResolvedValue({ revision_id: revision.id, checks: [] });
    await act(async () => { renderDetail(); });
    expect(mergeButton()).toBeEnabled();
    expect(screen.queryByRole("link", { name: "View checks" })).not.toBeInTheDocument();
  });
});
