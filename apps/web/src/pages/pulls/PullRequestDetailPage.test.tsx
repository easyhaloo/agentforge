import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../locales";
import { APIError, changesetAPI, organizationAPI, repositoryAPI, type OrganizationSummary, type PullRequestComment, type RepositorySettings, type StoredChangeset } from "../../shared/api/identity";
import { issuesAPI } from "../../shared/api/issues";
import { projectsAPI } from "../../shared/api/projects";
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
    tab={pathname.endsWith("/files") ? "files" : pathname.endsWith("/checks") ? "checks" : "conversation"} userID="reviewer"/>;
}

function renderDetail(tab?: "files") {
  return render(<MemoryRouter initialEntries={[pullRequestPath(org.slug, repo, pullNumber, tab)]}><Detail/></MemoryRouter>);
}

const mergeButton = () => screen.getByRole("button", { name: "Merge pull request" });
const sidebarWidthKey = "agentforge:pulls:filesSidebarWidth";
const sidebarHiddenKey = "agentforge:pulls:filesSidebarHidden";

const filePatch = [
  "diff --git a/src/feature/edit.txt b/src/feature/edit.txt", "@@ -7 +12 @@", "-old version", "+new version",
  "diff --git a/src/added.txt b/src/added.txt", "new file mode 100644", "@@ -0,0 +1 @@", "+added line",
  "diff --git a/deleted.txt b/deleted.txt", "deleted file mode 100644", "@@ -1 +0,0 @@", "-removed line",
  "diff --git a/before.txt b/renamed.txt", "rename from before.txt", "rename to renamed.txt",
].join("\n");

function mockFiles() {
  vi.mocked(changesetAPI.getComparison).mockResolvedValue({
    repository: repo, base_sha: "base", head_sha: revision.commit_sha, patch: filePatch, commits: [], commits_truncated: false,
  });
  vi.spyOn(changesetAPI, "getRequiredWorkflows").mockResolvedValue({ revision_id: revision.id, checks: [] });
}

describe("PullRequestDetailPage", () => {
  beforeAll(async () => { await i18n.changeLanguage("en-US"); });
  beforeEach(() => {
    vi.spyOn(changesetAPI, "get").mockResolvedValue(changeset);
    vi.spyOn(projectsAPI, "list").mockResolvedValue([]);
    vi.spyOn(issuesAPI, "list").mockResolvedValue({ items: [], total: 0, open_total: 0, closed_total: 0, limit: 20, offset: 0 });
    vi.spyOn(changesetAPI, "getComparison").mockRejectedValue(new Error("Unused in these tabs"));
    vi.spyOn(repositoryAPI, "settings").mockResolvedValue(settings);
    vi.spyOn(organizationAPI, "members").mockResolvedValue({ items: [], limit: 20, offset: 0 });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.removeItem(sidebarWidthKey);
    localStorage.removeItem(sidebarHiddenKey);
  });

  it("groups and filters files with semantic status, totals and selection that opens a folded patch", async () => {
    const keyboard = userEvent.setup();
    mockFiles();
    renderDetail("files");
    const tree = await screen.findByRole("navigation", { name: "Changed file tree" });
    expect(screen.getByText("4 files,")).toHaveTextContent("4 files, +2 -2");
    const folder = within(tree).getByText("feature").closest("details");
    const editLink = within(tree).getByRole("link", { name: "Modified edit.txt +1 -1" });
    expect(folder).toHaveAttribute("open");
    expect(editLink).toHaveAttribute("title", "src/feature/edit.txt");
    for (const status of ["Added", "Deleted", "Renamed", "Modified"]) {
      expect(within(tree).getByRole("img", { name: status })).toBeInTheDocument();
    }
    fireEvent.click(within(tree).getByText("feature"));
    expect(folder).not.toHaveAttribute("open");
    expect(editLink).not.toBeVisible();
    fireEvent.click(within(tree).getByText("feature"));

    const patchHeader = screen.getByText("src/feature/edit.txt");
    const scroll = vi.fn();
    Object.assign(patchHeader.closest("section")!, { scrollIntoView: scroll });
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(patchHeader.closest("details")).not.toHaveAttribute("open");
    editLink.focus();
    await keyboard.keyboard("{Enter}");
    expect(editLink).toHaveAttribute("aria-current", "location");
    expect(patchHeader.closest("details")).toHaveAttribute("open");
    await waitFor(() => {
      expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
      expect(patchHeader).toHaveFocus();
    });
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getByText("deleted.txt", { selector: "summary" }).closest("details")).toHaveAttribute("open");
    fireEvent.click(patchHeader);
    expect(patchHeader.closest("details")).not.toHaveAttribute("open");

    const href = editLink.getAttribute("href")!;
    const filter = screen.getByRole("textbox", { name: "Filter files" });
    fireEvent.change(filter, { target: { value: "SRC/FEATURE" } });
    expect(within(tree).getAllByRole("link")).toEqual([editLink]);
    expect(editLink).toHaveAttribute("href", href);
    expect(document.getElementById(decodeURIComponent(href.slice(1)))).toContainElement(patchHeader);
    fireEvent.change(filter, { target: { value: "unmatched" } });
    expect(screen.getByText("No files match the filter")).toBeVisible();
  });

  it("clamps pointer and keyboard resizing and persists width and visibility across mounts", async () => {
    mockFiles();
    const initial = renderDetail("files");
    const divider = await screen.findByRole("separator", { name: "Resize file tree" });
    expect(divider).toHaveAttribute("aria-valuenow", "280");
    const capture = vi.fn();
    Object.assign(divider, { setPointerCapture: capture });
    const pointer = (type: string, clientX: number) =>
      fireEvent(divider, Object.assign(new MouseEvent(type, { clientX, bubbles: true }), { pointerId: 1 }));
    pointer("pointerdown", 300);
    expect(capture).toHaveBeenCalledWith(1);
    pointer("pointermove", 900);
    expect(divider).toHaveAttribute("aria-valuenow", "480");
    pointer("pointerup", 900);
    pointer("lostpointercapture", 900);
    expect(localStorage.getItem(sidebarWidthKey)).toBe("480");
    fireEvent.keyDown(divider, { key: "Home" });
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(divider).toHaveAttribute("aria-valuenow", "200");
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(divider).toHaveAttribute("aria-valuenow", "210");

    fireEvent.click(screen.getByRole("button", { name: "Hide file tree" }));
    expect(screen.queryByRole("navigation", { name: "Changed file tree" })).not.toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: "Resize file tree" })).not.toBeInTheDocument();
    initial.unmount();
    renderDetail("files");
    fireEvent.click(await screen.findByRole("button", { name: "Show file tree" }));
    expect(screen.getByRole("separator", { name: "Resize file tree" })).toHaveAttribute("aria-valuenow", "210");
  });

  it("anchors comments to the active revision on both sides and preserves the draft and focus when the viewport narrows", async () => {
    const keyboard = userEvent.setup();
    mockFiles();
    const media = Object.assign(new EventTarget(), { matches: false });
    vi.stubGlobal("matchMedia", (query: string) => query === "(max-width: 760px)" ? media : { matches: false });
    const comment: PullRequestComment = { id: "comment", author: "author", body: "Current inline thread", created_at: timestamp,
      revision_id: revision.id, path: "src/feature/edit.txt", side: "left", line: 7 };
    const withComments = (currentComment = comment): StoredChangeset => ({ ...changeset, changeset: {
      ...changeset.changeset, pull_request: { ...changeset.changeset.pull_request!, comments: [currentComment,
        { ...comment, id: "stale", revision_id: "earlier-revision", body: "Stale inline thread" }] },
    } });
    vi.mocked(changesetAPI.get).mockResolvedValue(withComments());
    const addComment = vi.spyOn(changesetAPI, "addPullRequestComment")
      .mockRejectedValueOnce(new APIError("Stale inline anchor", 409))
      .mockResolvedValue(withComments());
    const resolve = vi.spyOn(changesetAPI, "setPullRequestCommentResolution").mockResolvedValueOnce(
      withComments({ ...comment, resolved_by: "reviewer", resolved_at: timestamp }),
    ).mockResolvedValue(withComments());
    const { container } = renderDetail("files");
    const split = await screen.findByRole("button", { name: "Split" });
    split.focus();
    await keyboard.keyboard(" ");
    expect(split).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".repository-diff__split-row")).not.toBeNull();
    expect(screen.getByText("Current inline thread")).toBeVisible();
    expect(screen.queryByText("Stale inline thread")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resolve conversation" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reopen conversation" }));
    expect(resolve.mock.calls).toEqual([[org.id, pullNumber, comment.id, true], [org.id, pullNumber, comment.id, false]]);
    await screen.findByRole("button", { name: "Resolve conversation" });

    const oldLine = () => screen.getByRole("button", { name: /src\/feature\/edit\.txt · Old line 7/ });
    const newLine = () => screen.getByRole("button", { name: /src\/feature\/edit\.txt · New line 12/ });
    const composer = () => screen.getByRole("textbox", { name: "Write a comment" });
    oldLine().focus();
    await keyboard.keyboard("{Enter}");
    expect(composer()).toHaveFocus();
    const summary = screen.getByText(comment.path!, { selector: "summary" });
    expect(summary).toHaveAttribute("aria-disabled", "true");
    // The browser test checks native <details> activation, which Happy DOM runs before React cancels it.
    expect(fireEvent.click(summary)).toBe(false);
    fireEvent.change(composer(), { target: { value: "On the old line" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(addComment).toHaveBeenCalledWith(org.id, pullNumber, "On the old line", revision.id, "src/feature/edit.txt", "left", 7);
    expect(await screen.findByRole("alert")).toHaveTextContent("That conflicts with the current state.");
    expect(composer()).toHaveValue("On the old line");
    await keyboard.keyboard("{Escape}");
    await waitFor(() => expect(oldLine()).toHaveFocus());

    fireEvent.click(newLine());
    fireEvent.change(composer(), { target: { value: "Draft for the new line" } });
    act(() => { media.matches = true; media.dispatchEvent(new Event("change")); });
    expect(split).toBeDisabled();
    expect(screen.getByRole("button", { name: "Unified" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("separator", { name: "Resize file tree" })).not.toBeInTheDocument();
    expect(container.querySelector(".repository-diff__split-row")).toBeNull();
    expect(composer()).toHaveValue("Draft for the new line");
    expect(composer()).toHaveFocus();
    await keyboard.keyboard("{Escape}");
    await waitFor(() => expect(newLine()).toHaveFocus());

    fireEvent.click(newLine());
    fireEvent.change(composer(), { target: { value: "On the new line" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(addComment).toHaveBeenLastCalledWith(org.id, pullNumber, "On the new line", revision.id, "src/feature/edit.txt", "right", 12);
    await waitFor(() => expect(newLine()).toHaveFocus());
    act(() => { media.matches = false; media.dispatchEvent(new Event("change")); });
    expect(split).toHaveAttribute("aria-pressed", "true");
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
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: /Conversation/ })); });
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
