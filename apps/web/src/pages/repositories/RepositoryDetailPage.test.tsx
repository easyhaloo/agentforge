import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { OrganizationSummary, RepositoryPreviewTree, RepositoryPreviewBlob } from "../../shared/api/identity";
import { repositoryPreviewAPI } from "../../shared/api/identity";
import { issuesAPI, type Issue } from "../../shared/api/issues";
import { RepositoryDetailPage } from "./RepositoryDetailPage";
import i18n from "../../locales";

vi.mock("../../shared/api/identity", async () => {
  const actual = await vi.importActual("../../shared/api/identity");
  return {
    ...actual,
    repositoryPreviewAPI: {
      tree: vi.fn(),
      blob: vi.fn(),
    },
  };
});

vi.mock("../../shared/api/issues", () => ({ issuesAPI: { list: vi.fn() } }));

const mockOrganization: OrganizationSummary = {
  id: "org-test",
  slug: "testorg",
  name: "Test Organization",
  role: "owner",
};

const mockTreeResponse: RepositoryPreviewTree = {
  repository: "testorg/testrepo",
  commit_sha: "abc123",
  path: "",
  items: [
    { name: "README.md", path: "README.md", kind: "file", mode: "100644", sha: "file1", size: 1024 },
    { name: "src", path: "src", kind: "tree", mode: "040000", sha: "dir1" },
    { name: "package.json", path: "package.json", kind: "file", mode: "100644", sha: "file2", size: 512 },
  ],
};

const mockSubtreeResponse: RepositoryPreviewTree = {
  repository: "testorg/testrepo",
  commit_sha: "abc123",
  path: "src",
  items: [
    { name: "index.ts", path: "src/index.ts", kind: "file", mode: "100644", sha: "file3", size: 2048 },
    { name: "utils.ts", path: "src/utils.ts", kind: "file", mode: "100644", sha: "file4", size: 768 },
  ],
};

const mockBlobResponse: RepositoryPreviewBlob = {
  repository: "testorg/testrepo",
  commit_sha: "abc123",
  blob_sha: "file1",
  path: "README.md",
  encoding: "utf-8",
  content: "# Test Repository\n\nThis is a test.",
};

describe("RepositoryDetailPage - Code Tab", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en-US");
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state while fetching the file tree", async () => {
    vi.mocked(repositoryPreviewAPI.tree).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    expect(screen.getByText("Loading repository files...")).toBeInTheDocument();
  });

  it("renders the file tree after loading", async () => {
    vi.mocked(repositoryPreviewAPI.tree).mockResolvedValue(mockTreeResponse);

    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    await waitFor(() => {
      expect(screen.getByText("README.md")).toBeInTheDocument();
      expect(screen.getByText("src")).toBeInTheDocument();
      expect(screen.getByText("package.json")).toBeInTheDocument();
    });
  });

  it("shows error message when tree loading fails", async () => {
    vi.mocked(repositoryPreviewAPI.tree).mockRejectedValue(new Error("Network error"));

    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    await waitFor(() => {
      expect(screen.getByText(/Error:.*Network error/)).toBeInTheDocument();
    });
  });

  it("expands folders and loads subtree when clicked", async () => {
    vi.mocked(repositoryPreviewAPI.tree).mockImplementation(async (orgId, repo, path) => {
      if (path === "") return mockTreeResponse;
      if (path === "src") return mockSubtreeResponse;
      throw new Error("Unexpected path");
    });

    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    await waitFor(() => {
      expect(screen.getByText("src")).toBeInTheDocument();
    });

    const srcFolder = screen.getByText("src").closest(".file-tree-item");
    expect(srcFolder).toBeInTheDocument();

    await user.click(srcFolder!);

    await waitFor(() => {
      expect(screen.getByText("index.ts")).toBeInTheDocument();
      expect(screen.getByText("utils.ts")).toBeInTheDocument();
    });

    expect(repositoryPreviewAPI.tree).toHaveBeenCalledWith("org-test", "testorg/testrepo", "src", "");
  });

  it("loads and displays file content when a file is selected", async () => {
    vi.mocked(repositoryPreviewAPI.tree).mockResolvedValue(mockTreeResponse);
    vi.mocked(repositoryPreviewAPI.blob).mockResolvedValue(mockBlobResponse);

    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    await waitFor(() => {
      expect(screen.getByText("README.md")).toBeInTheDocument();
    });

    const readmeFile = screen.getByText("README.md").closest(".file-tree-item");
    await user.click(readmeFile!);

    await waitFor(() => {
      expect(repositoryPreviewAPI.blob).toHaveBeenCalledWith("org-test", "testorg/testrepo", "README.md", "");
      expect(screen.getByText(/Test Repository/)).toBeInTheDocument();
    });
  });

  it("displays file metadata in the header", async () => {
    vi.mocked(repositoryPreviewAPI.tree).mockResolvedValue(mockTreeResponse);
    vi.mocked(repositoryPreviewAPI.blob).mockResolvedValue(mockBlobResponse);

    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    await waitFor(() => {
      expect(screen.getByText("README.md")).toBeInTheDocument();
    });

    const readmeFile = screen.getByText("README.md").closest(".file-tree-item");
    await user.click(readmeFile!);

    await waitFor(() => {
      const fileHeader = document.querySelector(".file-header");
      expect(fileHeader).toBeInTheDocument();
      expect(fileHeader?.textContent).toContain("README.md");
      expect(screen.getByText(/1.0 KB/)).toBeInTheDocument();
    });
  });

  it("collapses expanded folders when clicked again", async () => {
    vi.mocked(repositoryPreviewAPI.tree).mockImplementation(async (orgId, repo, path) => {
      if (path === "") return mockTreeResponse;
      if (path === "src") return mockSubtreeResponse;
      throw new Error("Unexpected path");
    });

    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    await waitFor(() => {
      expect(screen.getByText("src")).toBeInTheDocument();
    });

    const srcFolder = screen.getByText("src").closest(".file-tree-item");

    await user.click(srcFolder!);
    await waitFor(() => {
      expect(screen.getByText("index.ts")).toBeInTheDocument();
    });

    await user.click(srcFolder!);
    await waitFor(() => {
      expect(screen.queryByText("index.ts")).not.toBeInTheDocument();
    });
  });
});

describe("RepositoryDetailPage - Wiki Tab", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en-US");
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the wiki tab when clicked", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const wikiTab = screen.getByRole("tab", { name: /Wiki/i });
    await user.click(wikiTab);

    expect(screen.getByText("Wiki Pages")).toBeInTheDocument();
  });

  it("displays all wiki pages in the sidebar", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const wikiTab = screen.getByRole("tab", { name: /Wiki/i });
    await user.click(wikiTab);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Home$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Getting Started/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Architecture$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /API Reference/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Contributing$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^FAQ$/i })).toBeInTheDocument();
    });
  });

  it("displays the Home page content by default", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const wikiTab = screen.getByRole("tab", { name: /Wiki/i });
    await user.click(wikiTab);

    await waitFor(() => {
      const wikiHeader = document.querySelector(".wiki-header");
      expect(wikiHeader?.textContent).toContain("Home");
      expect(screen.getByText("Welcome to AgentForge Wiki")).toBeInTheDocument();
      expect(screen.getByText(/comprehensive platform for building/i)).toBeInTheDocument();
    });
  });

  it("switches wiki page content when a different page is clicked", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const wikiTab = screen.getByRole("tab", { name: /Wiki/i });
    await user.click(wikiTab);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Getting Started/i })).toBeInTheDocument();
    });

    const gettingStartedButton = screen.getByRole("button", { name: /Getting Started/i });
    await user.click(gettingStartedButton);

    await waitFor(() => {
      const wikiHeader = document.querySelector(".wiki-header");
      expect(wikiHeader?.textContent).toContain("Getting Started");
      expect(screen.getByText("Getting Started with AgentForge")).toBeInTheDocument();
      expect(screen.getByText(/help you get up and running/i)).toBeInTheDocument();
    });
  });

  it("highlights the active wiki page in the sidebar", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const wikiTab = screen.getByRole("tab", { name: /Wiki/i });
    await user.click(wikiTab);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Architecture$/i })).toBeInTheDocument();
    });

    const architectureButton = screen.getByRole("button", { name: /^Architecture$/i });
    await user.click(architectureButton);

    await waitFor(() => {
      expect(architectureButton).toHaveClass("active");
    });
  });

  it("renders markdown content with proper formatting", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const wikiTab = screen.getByRole("tab", { name: /Wiki/i });
    await user.click(wikiTab);

    await waitFor(() => {
      const wikiBody = document.querySelector(".wiki-body");
      expect(wikiBody).toBeInTheDocument();

      const h1Elements = wikiBody?.querySelectorAll("h1");
      expect(h1Elements).toBeTruthy();
      expect(h1Elements!.length).toBeGreaterThan(0);
    });
  });

  it("displays all six wiki pages with correct titles", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const wikiTab = screen.getByRole("tab", { name: /Wiki/i });
    await user.click(wikiTab);

    const expectedPages = ["Home", "Getting Started", "Architecture", "API Reference", "Contributing", "FAQ"];

    await waitFor(() => {
      expectedPages.forEach((pageName) => {
        const pattern = pageName === "Home" || pageName === "Architecture" || pageName === "Contributing" || pageName === "FAQ"
          ? new RegExp(`^${pageName}$`, "i")
          : new RegExp(pageName, "i");
        expect(screen.getByRole("button", { name: pattern })).toBeInTheDocument();
      });
    });
  });
});

describe("RepositoryDetailPage - Issues Tab", () => {
  const date = "2024-01-15T10:30:00Z";
  const fixtureIssue = (number: number, title: string, fields: Partial<Issue> = {}): Issue => ({
    id: `issue-${number}`, number, title, repository: "testorg/testrepo", body: "", state: "open",
    locked: false, comments: 0, labels: [], assignees: [], created_by: "alice", created_at: date, updated_at: date, ...fields,
  });
  const openIssues = [
    fixtureIssue(1, "Add support for custom authentication providers"),
    fixtureIssue(2, "Fix memory leak in agent executor", { created_by: "bob" }),
    fixtureIssue(3, "Add dark mode support to UI"),
    fixtureIssue(4, "Rate limiting not working for API endpoints", { created_by: "bob" }),
    fixtureIssue(5, "Implement webhook retry mechanism"),
  ];
  const closedIssues = [
    fixtureIssue(6, "Improve documentation for pipeline API", { state: "closed" }),
    fixtureIssue(7, "Update dependencies", { state: "closed" }),
    fixtureIssue(8, "Fix database migration", { state: "closed" }),
  ];
  const page = (items: Issue[], total = items.length, offset = 0) => ({
    items, total, open_total: 5, closed_total: 3, limit: 20, offset,
    filter_options: { authors: ["alice", "bob"], labels: ["bug"], assignees: ["alice"], milestones: [] },
  });
  beforeAll(async () => {
    await i18n.changeLanguage("en-US");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repositoryPreviewAPI.tree).mockResolvedValue(mockTreeResponse);
    vi.mocked(issuesAPI.list).mockReset().mockImplementation(async (_, params) => {
      if (params?.state === "closed") return page(closedIssues);
      if (params?.assignee === "alice" || params?.q === "memory leak") return page([openIssues[1]]);
      if (params?.created_by === "alice") return page([openIssues[0], openIssues[2]]);
      if (params?.created_by === "bob" || params?.labels === "bug") return page([openIssues[1], openIssues[3]]);
      if (params?.sort === "created" && params.direction === "desc") return page([openIssues[1], openIssues[0]]);
      return page(openIssues);
    });
  });

  it("switches to Issues tab when clicked", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" userId="alice" />);

    await waitFor(() => {
      expect(screen.getByText("Files")).toBeInTheDocument();
    });

    const issuesTab = screen.getByRole("tab", { name: /Issues/i });
    await user.click(issuesTab);

    await waitFor(() => {
      expect(screen.getByText("Filters")).toBeInTheDocument();
      expect(screen.getByText("Open issues")).toBeInTheDocument();
      expect(screen.getByText("Closed issues")).toBeInTheDocument();
    });
  });

  it("displays issue list with correct columns", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" userId="alice" />);

    const issuesTab = screen.getByRole("tab", { name: /Issues/i });
    await user.click(issuesTab);

    await waitFor(() => {
      const table = document.querySelector(".af-table");
      expect(table).toBeInTheDocument();
      const headers = table?.querySelectorAll("thead th");
      const headerTexts = Array.from(headers || []).map((h) => h.textContent);
      expect(headerTexts).toContain("Issue");
      expect(headerTexts).toContain("Author");
      expect(headerTexts).toContain("Assignee");
      expect(headerTexts).toContain("Comments");
      expect(headerTexts).toContain("Updated");
    });
  });

  it("filters issues by status when sidebar filter is clicked", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" userId="alice" />);

    const issuesTab = screen.getByRole("tab", { name: /Issues/i });
    await user.click(issuesTab);

    await waitFor(() => {
      expect(screen.getByText("Add support for custom authentication providers")).toBeInTheDocument();
    });

    const closedButton = screen.getByText("Closed issues").closest("button");
    await user.click(closedButton!);

    await waitFor(() => {
      expect(screen.getByText("Improve documentation for pipeline API")).toBeInTheDocument();
      expect(screen.queryByText("Add support for custom authentication providers")).not.toBeInTheDocument();
    });
  });

  it("filters issues assigned to current user", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" userId="alice" />);

    const issuesTab = screen.getByRole("tab", { name: /Issues/i });
    await user.click(issuesTab);

    await waitFor(() => {
      expect(screen.getByText("Open issues")).toBeInTheDocument();
    });

    const assignedButton = screen.getByText("Assigned to me").closest("button");
    await user.click(assignedButton!);

    await waitFor(() => {
      expect(issuesAPI.list).toHaveBeenLastCalledWith("org-test", expect.objectContaining({ assignee: "alice" }), expect.any(AbortSignal));
      expect(screen.getByText("Fix memory leak in agent executor")).toBeInTheDocument();
      expect(screen.queryByText("Add support for custom authentication providers")).not.toBeInTheDocument();
    });
  });

  it("filters issues created by current user", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" userId="alice" />);

    const issuesTab = screen.getByRole("tab", { name: /Issues/i });
    await user.click(issuesTab);

    await waitFor(() => {
      expect(screen.getByText("Open issues")).toBeInTheDocument();
    });

    const createdButton = screen.getByText("Created by me").closest("button");
    await user.click(createdButton!);

    await waitFor(() => {
      expect(screen.getByText("Add support for custom authentication providers")).toBeInTheDocument();
      expect(issuesAPI.list).toHaveBeenLastCalledWith("org-test", expect.objectContaining({ created_by: "alice" }), expect.any(AbortSignal));
      expect(screen.getByText("Add dark mode support to UI")).toBeInTheDocument();
      expect(screen.queryByText("Fix memory leak in agent executor")).not.toBeInTheDocument();
    });
  });

  it("searches issues by title", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" userId="alice" />);

    const issuesTab = screen.getByRole("tab", { name: /Issues/i });
    await user.click(issuesTab);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search issues...")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search issues...");
    await user.type(searchInput, "memory leak");

    await waitFor(() => {
      expect(screen.getByText("Fix memory leak in agent executor")).toBeInTheDocument();
      expect(screen.queryByText("Add support for custom authentication providers")).not.toBeInTheDocument();
    });
  });

  it("filters issues by author", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" userId="alice" />);

    const issuesTab = screen.getByRole("tab", { name: /Issues/i });
    await user.click(issuesTab);

    await waitFor(() => {
      expect(screen.getByLabelText("Filter by author")).toBeInTheDocument();
    });

    const authorSelect = screen.getByLabelText("Filter by author");
    await user.click(authorSelect);

    const authorOption = screen.getByRole("option", { name: "bob" });
    await user.click(authorOption);

    await waitFor(() => {
      expect(screen.getByText("Fix memory leak in agent executor")).toBeInTheDocument();
      expect(screen.getByText("Rate limiting not working for API endpoints")).toBeInTheDocument();
    });
  });

  it("filters issues by label", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" userId="alice" />);

    const issuesTab = screen.getByRole("tab", { name: /Issues/i });
    await user.click(issuesTab);

    await waitFor(() => {
      expect(screen.getByLabelText("Filter by label")).toBeInTheDocument();
    });

    const labelSelect = screen.getByLabelText("Filter by label");
    await user.click(labelSelect);

    const labelOption = screen.getByRole("option", { name: "bug" });
    await user.click(labelOption);

    await waitFor(() => {
      expect(screen.getByText("Fix memory leak in agent executor")).toBeInTheDocument();
      expect(screen.getByText("Rate limiting not working for API endpoints")).toBeInTheDocument();
    });
  });

  it("displays issue counts in sidebar", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" userId="alice" />);

    const issuesTab = screen.getByRole("tab", { name: /Issues/i });
    await user.click(issuesTab);

    await waitFor(() => {
      const openIssuesButton = screen.getByText("Open issues").closest("button");
      expect(openIssuesButton?.querySelector(".issue-count")?.textContent).toBe("5");

      const closedIssuesButton = screen.getByText("Closed issues").closest("button");
      expect(closedIssuesButton?.querySelector(".issue-count")?.textContent).toBe("3");
    });
  });

  it("displays total and filtered issue counts in footer", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" userId="alice" />);

    const issuesTab = screen.getByRole("tab", { name: /Issues/i });
    await user.click(issuesTab);

    await waitFor(() => {
      expect(screen.getByText("Showing 5 of 8 issues")).toBeInTheDocument();
    });

    const closedButton = screen.getByText("Closed issues").closest("button");
    await user.click(closedButton!);

    await waitFor(() => {
      expect(screen.getByText("Showing 3 of 8 issues")).toBeInTheDocument();
    });
  });

  it("sorts issues by newest", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" userId="alice" />);

    const issuesTab = screen.getByRole("tab", { name: /Issues/i });
    await user.click(issuesTab);

    await waitFor(() => {
      expect(screen.getByLabelText("Sort by")).toBeInTheDocument();
    });

    const sortSelect = screen.getByLabelText("Sort by");
    await user.click(sortSelect);

    const newestOption = screen.getByRole("option", { name: "Newest" });
    await user.click(newestOption);

    await waitFor(() => {
      const rows = document.querySelectorAll(".af-table tbody tr");
      expect(rows[0]?.textContent).toContain("Fix memory leak in agent executor");
    });
  });

  it("retries a failed request and resets the page when filters change", async () => {
    const user = userEvent.setup();
    vi.mocked(issuesAPI.list)
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(page(openIssues, 21))
      .mockResolvedValueOnce(page([openIssues[4]], 21, 20));
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" userId="alice" />);
    await user.click(screen.getByRole("tab", { name: "Issues" }));
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await user.click(await screen.findByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Previous" })).toBeEnabled();
    expect(issuesAPI.list).toHaveBeenLastCalledWith("org-test", expect.objectContaining({ offset: 20 }), expect.any(AbortSignal));
    await user.click(screen.getByRole("button", { name: /Closed issues/ }));
    expect(await screen.findByText("Improve documentation for pipeline API")).toBeVisible();
    expect(issuesAPI.list).toHaveBeenLastCalledWith("org-test", expect.objectContaining({ offset: 0, state: "closed" }), expect.any(AbortSignal));
  });

  it("shows 'New issue' button", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" userId="alice" />);

    const issuesTab = screen.getByRole("tab", { name: /Issues/i });
    await user.click(issuesTab);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /New issue/i })).toBeInTheDocument();
    });
  });
});

describe("RepositoryDetailPage - Pull Requests Tab", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en-US");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repositoryPreviewAPI.tree).mockResolvedValue(mockTreeResponse);
  });

  it("switches to Pull Requests tab when clicked", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    await waitFor(() => {
      expect(screen.getByText("Files")).toBeInTheDocument();
    });

    const pullsTab = screen.getByRole("tab", { name: /Pull Requests/i });
    await user.click(pullsTab);

    await waitFor(() => {
      expect(screen.getByText("This Repository")).toBeInTheDocument();
      expect(screen.getByText("Related")).toBeInTheDocument();
      expect(screen.getByText("Filters")).toBeInTheDocument();
    });
  });

  it("displays sub-tabs for This Repository and Related", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const pullsTab = screen.getByRole("tab", { name: /Pull Requests/i });
    await user.click(pullsTab);

    await waitFor(() => {
      const thisRepoTab = screen.getByText("This Repository").closest("button");
      const relatedTab = screen.getByText("Related").closest("button");

      expect(thisRepoTab).toBeInTheDocument();
      expect(relatedTab).toBeInTheDocument();
      expect(thisRepoTab).toHaveClass("active");
    });
  });

  it("switches between sub-tabs when clicked", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const pullsTab = screen.getByRole("tab", { name: /Pull Requests/i });
    await user.click(pullsTab);

    await waitFor(() => {
      expect(screen.getByText("This Repository")).toBeInTheDocument();
    });

    const relatedTab = screen.getByText("Related").closest("button");
    await user.click(relatedTab!);

    await waitFor(() => {
      expect(relatedTab).toHaveClass("active");
    });
  });

  it("displays pull request list with correct information", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const pullsTab = screen.getByRole("tab", { name: /Pull Requests/i });
    await user.click(pullsTab);

    await waitFor(() => {
      expect(screen.getByText("Add support for multi-agent coordination workflows")).toBeInTheDocument();
      expect(screen.getByText("Fix memory leak in agent task executor")).toBeInTheDocument();
      expect(screen.getByText("Implement streaming response support for LLM agents")).toBeInTheDocument();
    });
  });

  it("displays PR metadata including author and branches", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const pullsTab = screen.getByRole("tab", { name: /Pull Requests/i });
    await user.click(pullsTab);

    await waitFor(() => {
      expect(screen.getAllByText(/opened by alice-dev/)[0]).toBeInTheDocument();
      expect(screen.getAllByText(/opened by bob-eng/)[0]).toBeInTheDocument();
      expect(screen.getByText(/feature\/multi-agent → main/)).toBeInTheDocument();
    });
  });

  it("filters PRs by status when sidebar filter is clicked", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const pullsTab = screen.getByRole("tab", { name: /Pull Requests/i });
    await user.click(pullsTab);

    await waitFor(() => {
      expect(screen.getByText(/All \(5\)/)).toBeInTheDocument();
    });

    const openButton = screen.getByText(/Open \(2\)/).closest("button");
    await user.click(openButton!);

    await waitFor(() => {
      expect(screen.getByText("Add support for multi-agent coordination workflows")).toBeInTheDocument();
      expect(screen.getByText("Implement streaming response support for LLM agents")).toBeInTheDocument();
      expect(screen.queryByText("Fix memory leak in agent task executor")).not.toBeInTheDocument();
    });
  });

  it("filters PRs by merged status", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const pullsTab = screen.getByRole("tab", { name: /Pull Requests/i });
    await user.click(pullsTab);

    await waitFor(() => {
      expect(screen.getByText(/Merged \(2\)/)).toBeInTheDocument();
    });

    const mergedButton = screen.getByText(/Merged \(2\)/).closest("button");
    await user.click(mergedButton!);

    await waitFor(() => {
      expect(screen.getByText("Fix memory leak in agent task executor")).toBeInTheDocument();
      expect(screen.getByText("Add authentication middleware for API endpoints")).toBeInTheDocument();
      expect(screen.queryByText("Add support for multi-agent coordination workflows")).not.toBeInTheDocument();
    });
  });

  it("filters PRs by author using dropdown", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const pullsTab = screen.getByRole("tab", { name: /Pull Requests/i });
    await user.click(pullsTab);

    const authorSelect = await screen.findByRole("combobox", { name: "Filter pull requests by author" });
    await user.click(authorSelect);
    await user.click(screen.getByRole("option", { name: "alice-dev" }));

    await waitFor(() => {
      expect(screen.getByText("Add support for multi-agent coordination workflows")).toBeInTheDocument();
      expect(screen.queryByText("Fix memory leak in agent task executor")).not.toBeInTheDocument();
    });
  });

  it("searches PRs by title", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const pullsTab = screen.getByRole("tab", { name: /Pull Requests/i });
    await user.click(pullsTab);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search pull requests/i)).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search pull requests/i);
    await user.type(searchInput, "streaming");

    await waitFor(() => {
      expect(screen.getByText("Implement streaming response support for LLM agents")).toBeInTheDocument();
      expect(screen.queryByText("Add support for multi-agent coordination workflows")).not.toBeInTheDocument();
    });
  });

  it("searches PRs by number", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const pullsTab = screen.getByRole("tab", { name: /Pull Requests/i });
    await user.click(pullsTab);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search pull requests/i)).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search pull requests/i);
    await user.type(searchInput, "142");

    await waitFor(() => {
      expect(screen.getByText("Add support for multi-agent coordination workflows")).toBeInTheDocument();
      expect(screen.queryByText("Fix memory leak in agent task executor")).not.toBeInTheDocument();
    });
  });

  it("sorts PRs by newest", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const pullsTab = screen.getByRole("tab", { name: /Pull Requests/i });
    await user.click(pullsTab);

    const sortSelect = await screen.findByRole("combobox", { name: "Sort pull requests by" });
    await user.click(sortSelect);
    await user.click(screen.getByRole("option", { name: /^Newest/ }));

    await waitFor(() => {
      const prItems = document.querySelectorAll(".pr-item");
      expect(prItems[0]?.textContent).toContain("Add support for multi-agent coordination workflows");
    });
  });

  it("sorts PRs by most commented", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const pullsTab = screen.getByRole("tab", { name: /Pull Requests/i });
    await user.click(pullsTab);

    const sortSelect = await screen.findByRole("combobox", { name: "Sort pull requests by" });
    await user.click(sortSelect);
    await user.click(screen.getByRole("option", { name: "Most commented" }));

    await waitFor(() => {
      const prItems = document.querySelectorAll(".pr-item");
      expect(prItems[0]?.textContent).toContain("Add authentication middleware for API endpoints");
    });
  });

  it("displays PR status icons correctly", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const pullsTab = screen.getByRole("tab", { name: /Pull Requests/i });
    await user.click(pullsTab);

    await waitFor(() => {
      const openIcons = document.querySelectorAll(".pr-status-icon.open");
      const mergedIcons = document.querySelectorAll(".pr-status-icon.merged");
      const closedIcons = document.querySelectorAll(".pr-status-icon.closed");

      expect(openIcons.length).toBe(2);
      expect(mergedIcons.length).toBe(2);
      expect(closedIcons.length).toBe(1);
    });
  });

  it("displays PR labels", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const pullsTab = screen.getByRole("tab", { name: /Pull Requests/i });
    await user.click(pullsTab);

    await waitFor(() => {
      // Several pull requests carry the same label, so the labels are counted, not matched once.
      expect(screen.getAllByText("enhancement").length).toBeGreaterThan(0);
      expect(screen.getAllByText("bug").length).toBeGreaterThan(0);
      expect(screen.getAllByText("security").length).toBeGreaterThan(0);
    });
  });

  it("filters PRs by label", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const pullsTab = screen.getByRole("tab", { name: /Pull Requests/i });
    await user.click(pullsTab);

    const labelSelect = await screen.findByRole("combobox", { name: "Filter pull requests by label" });
    await user.click(labelSelect);
    await user.click(screen.getByRole("option", { name: "bug" }));

    await waitFor(() => {
      expect(screen.getByText("Fix memory leak in agent task executor")).toBeInTheDocument();
      expect(screen.queryByText("Add authentication middleware for API endpoints")).not.toBeInTheDocument();
    });
  });

  it("displays review status badges", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const pullsTab = screen.getByRole("tab", { name: /Pull Requests/i });
    await user.click(pullsTab);

    await waitFor(() => {
      expect(screen.getAllByText("✓ Approved").length).toBeGreaterThan(0);
      expect(screen.getAllByText("⚠ Changes requested").length).toBeGreaterThan(0);
    });
  });

  it("displays comment counts", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const pullsTab = screen.getByRole("tab", { name: /Pull Requests/i });
    await user.click(pullsTab);

    await waitFor(() => {
      const prStats = document.querySelectorAll(".pr-stat");
      expect(prStats.length).toBeGreaterThan(0);
    });
  });

  it("shows empty state when no PRs match filters", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const pullsTab = screen.getByRole("tab", { name: /Pull Requests/i });
    await user.click(pullsTab);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search pull requests/i)).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search pull requests/i);
    await user.type(searchInput, "nonexistent-search-term-xyz");

    await waitFor(() => {
      expect(screen.getByText("No pull requests found")).toBeInTheDocument();
    });
  });

  it("displays status counts in filter sidebar", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const pullsTab = screen.getByRole("tab", { name: /Pull Requests/i });
    await user.click(pullsTab);

    await waitFor(() => {
      expect(screen.getByText(/All \(5\)/)).toBeInTheDocument();
      expect(screen.getByText(/Open \(2\)/)).toBeInTheDocument();
      expect(screen.getByText(/Merged \(2\)/)).toBeInTheDocument();
      expect(screen.getByText(/Closed \(1\)/)).toBeInTheDocument();
    });
  });
});

describe("RepositoryDetailPage - Members Tab", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en-US");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repositoryPreviewAPI.tree).mockResolvedValue(mockTreeResponse);
  });

  it("switches to Members tab when clicked", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    await waitFor(() => {
      expect(screen.getByText("Files")).toBeInTheDocument();
    });

    const membersTab = screen.getByRole("tab", { name: /Members/i });
    await user.click(membersTab);

    await waitFor(() => {
      expect(screen.getByText("Filters")).toBeInTheDocument();
      expect(screen.getByText("Repository Members")).toBeInTheDocument();
    });
  });

  it("restricts access for non-admin users", async () => {
    const nonAdminOrg: OrganizationSummary = {
      ...mockOrganization,
      role: "member",
    };

    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={nonAdminOrg} repositorySlug="testrepo" />);

    const membersTab = screen.getByRole("tab", { name: /Members/i });
    await user.click(membersTab);

    await waitFor(() => {
      expect(screen.getByText("Access Restricted")).toBeInTheDocument();
      expect(screen.getByText("Only repository administrators can view the members list.")).toBeInTheDocument();
    });
  });

  it("allows access for admin users", async () => {
    const adminOrg: OrganizationSummary = {
      ...mockOrganization,
      role: "admin",
    };

    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={adminOrg} repositorySlug="testrepo" />);

    const membersTab = screen.getByRole("tab", { name: /Members/i });
    await user.click(membersTab);

    await waitFor(() => {
      expect(screen.getByText("Repository Members")).toBeInTheDocument();
      expect(screen.queryByText("Access Restricted")).not.toBeInTheDocument();
    });
  });

  it("displays member list with correct columns", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const membersTab = screen.getByRole("tab", { name: /Members/i });
    await user.click(membersTab);

    await waitFor(() => {
      const table = document.querySelector(".af-table");
      expect(table).toBeInTheDocument();
      const headers = table?.querySelectorAll("thead th");
      const headerTexts = Array.from(headers || []).map((h) => h.textContent);
      expect(headerTexts).toContain("Member");
      expect(headerTexts).toContain("Role");
      expect(headerTexts).toContain("Last Active");
    });
  });

  it("displays member information correctly", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const membersTab = screen.getByRole("tab", { name: /Members/i });
    await user.click(membersTab);

    await waitFor(() => {
      expect(screen.getByText("alice-smith")).toBeInTheDocument();
      expect(screen.getByText("alice@agentforge.dev")).toBeInTheDocument();
      expect(screen.getByText("bob-jones")).toBeInTheDocument();
      expect(screen.getByText("bob@agentforge.dev")).toBeInTheDocument();
    });
  });

  it("displays role badges with correct styling", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const membersTab = screen.getByRole("tab", { name: /Members/i });
    await user.click(membersTab);

    await waitFor(() => {
      const ownerBadge = screen.getByText("Owner").closest(".member-role-badge");
      const memberBadges = screen.getAllByText("Member");
      const externalBadges = screen.getAllByText("External Collaborator");

      expect(ownerBadge).toHaveClass("member-role-owner");
      expect(memberBadges.length).toBeGreaterThan(0);
      expect(externalBadges.length).toBeGreaterThan(0);
    });
  });

  it("displays filter sidebar with correct counts", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const membersTab = screen.getByRole("tab", { name: /Members/i });
    await user.click(membersTab);

    await waitFor(() => {
      const allMembersButton = screen.getByText("All Members").closest("button");
      const orgMembersButton = screen.getByText("Organization Members").closest("button");
      const externalButton = screen.getByText("External Collaborators").closest("button");

      expect(allMembersButton?.querySelector(".members-filter-count")?.textContent).toBe("6");
      expect(orgMembersButton?.querySelector(".members-filter-count")?.textContent).toBe("4");
      expect(externalButton?.querySelector(".members-filter-count")?.textContent).toBe("2");
    });
  });

  it("filters members by organization", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const membersTab = screen.getByRole("tab", { name: /Members/i });
    await user.click(membersTab);

    await waitFor(() => {
      expect(screen.getByText("alice-smith")).toBeInTheDocument();
      expect(screen.getByText("david-brown")).toBeInTheDocument();
    });

    const orgMembersButton = screen.getByText("Organization Members").closest("button");
    await user.click(orgMembersButton!);

    await waitFor(() => {
      expect(screen.getByText("alice-smith")).toBeInTheDocument();
      expect(screen.getByText("bob-jones")).toBeInTheDocument();
      expect(screen.queryByText("david-brown")).not.toBeInTheDocument();
      expect(screen.queryByText("eve-davis")).not.toBeInTheDocument();
    });
  });

  it("filters members by external collaborators", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const membersTab = screen.getByRole("tab", { name: /Members/i });
    await user.click(membersTab);

    await waitFor(() => {
      expect(screen.getByText("Organization Members")).toBeInTheDocument();
    });

    const externalButton = screen.getByText("External Collaborators").closest("button");
    await user.click(externalButton!);

    await waitFor(() => {
      expect(screen.getByText("david-brown")).toBeInTheDocument();
      expect(screen.getByText("eve-davis")).toBeInTheDocument();
      expect(screen.queryByText("alice-smith")).not.toBeInTheDocument();
      expect(screen.queryByText("bob-jones")).not.toBeInTheDocument();
    });
  });

  it("shows empty state for pending invitations", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const membersTab = screen.getByRole("tab", { name: /Members/i });
    await user.click(membersTab);

    await waitFor(() => {
      expect(screen.getByText("Pending Invitations")).toBeInTheDocument();
    });

    const pendingButton = screen.getByText("Pending Invitations").closest("button");
    await user.click(pendingButton!);

    await waitFor(() => {
      expect(screen.getByText("No members found")).toBeInTheDocument();
    });
  });

  it("highlights active filter in sidebar", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const membersTab = screen.getByRole("tab", { name: /Members/i });
    await user.click(membersTab);

    await waitFor(() => {
      const allMembersButton = screen.getByText("All Members").closest("button");
      expect(allMembersButton).toHaveClass("active");
    });

    const orgMembersButton = screen.getByText("Organization Members").closest("button");
    await user.click(orgMembersButton!);

    await waitFor(() => {
      expect(orgMembersButton).toHaveClass("active");
      const allMembersButton = screen.getByText("All Members").closest("button");
      expect(allMembersButton).not.toHaveClass("active");
    });
  });

  it("displays invite member button", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const membersTab = screen.getByRole("tab", { name: /Members/i });
    await user.click(membersTab);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Invite Member/i })).toBeInTheDocument();
    });
  });

  it("displays member avatars", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const membersTab = screen.getByRole("tab", { name: /Members/i });
    await user.click(membersTab);

    await waitFor(() => {
      const avatars = document.querySelectorAll(".member-avatar");
      expect(avatars.length).toBeGreaterThan(0);
      expect(avatars[0]?.textContent).toBe("AS");
    });
  });

  it("displays last active time correctly", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const membersTab = screen.getByRole("tab", { name: /Members/i });
    await user.click(membersTab);

    await waitFor(() => {
      const table = document.querySelector(".af-table");
      expect(table).toBeInTheDocument();
      const lastActiveCell = table?.querySelector("tbody tr td:last-child");
      expect(lastActiveCell?.textContent).toMatch(/days ago|Today|Yesterday/);
    });
  });
});

describe("RepositoryDetailPage - Settings Tab", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en-US");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repositoryPreviewAPI.tree).mockResolvedValue(mockTreeResponse);
  });

  it("shows Settings tab only for repository owners", async () => {
    const ownerOrg: OrganizationSummary = { ...mockOrganization, role: "owner" };
    const { rerender } = render(<RepositoryDetailPage organization={ownerOrg} repositorySlug="testrepo" />);

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Settings/i })).toBeInTheDocument();
    });

    const memberOrg: OrganizationSummary = { ...mockOrganization, role: "member" };
    rerender(<RepositoryDetailPage organization={memberOrg} repositorySlug="testrepo" />);

    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: /Settings/i })).not.toBeInTheDocument();
    });
  });

  it("hides Settings tab for admin role", async () => {
    const adminOrg: OrganizationSummary = { ...mockOrganization, role: "admin" };
    render(<RepositoryDetailPage organization={adminOrg} repositorySlug="testrepo" />);

    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: /Settings/i })).not.toBeInTheDocument();
    });
  });

  it("switches to Settings tab when clicked", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    await waitFor(() => {
      expect(screen.getByText("Files")).toBeInTheDocument();
    });

    const settingsTab = screen.getByRole("tab", { name: /Settings/i });
    await user.click(settingsTab);

    await waitFor(() => {
      expect(screen.getByText("Repository Settings")).toBeInTheDocument();
    });
  });

  it("displays all settings navigation sections", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const settingsTab = screen.getByRole("tab", { name: /Settings/i });
    await user.click(settingsTab);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^General$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Access$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Branches$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Tags$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Notifications$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Webhooks$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Moderation$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Rulesets$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Actions$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Environments$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Secrets$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Copilot$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Pages$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Security$/i })).toBeInTheDocument();
    });
  });

  it("displays General settings page by default", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const settingsTab = screen.getByRole("tab", { name: /Settings/i });
    await user.click(settingsTab);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
      expect(screen.getByText("Manage repository settings including name, description, and visibility")).toBeInTheDocument();
      expect(screen.getByText("Repository Name")).toBeInTheDocument();
    });
  });

  it("switches to Branches settings when clicked", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const settingsTab = screen.getByRole("tab", { name: /Settings/i });
    await user.click(settingsTab);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Branches$/i })).toBeInTheDocument();
    });

    const branchesButton = screen.getByRole("button", { name: /^Branches$/i });
    await user.click(branchesButton);

    await waitFor(() => {
      expect(screen.getByText("Manage branch protection rules and default branch")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Default Branch" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Branch Protection Rules" })).toBeInTheDocument();
    });
  });

  it("switches to Actions settings when clicked", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const settingsTab = screen.getByRole("tab", { name: /Settings/i });
    await user.click(settingsTab);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Actions$/i })).toBeInTheDocument();
    });

    const actionsButton = screen.getByRole("button", { name: /^Actions$/i });
    await user.click(actionsButton);

    await waitFor(() => {
      expect(screen.getByText("Configure GitHub Actions permissions and settings")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Actions Permissions" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Workflow Permissions" })).toBeInTheDocument();
    });
  });

  it("switches to Secrets settings when clicked", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const settingsTab = screen.getByRole("tab", { name: /Settings/i });
    await user.click(settingsTab);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Secrets$/i })).toBeInTheDocument();
    });

    const secretsButton = screen.getByRole("button", { name: /^Secrets$/i });
    await user.click(secretsButton);

    await waitFor(() => {
      expect(screen.getByText("Secrets and Variables")).toBeInTheDocument();
      expect(screen.getByText("Repository Secrets")).toBeInTheDocument();
      expect(screen.getByText("Repository Variables")).toBeInTheDocument();
    });
  });

  it("highlights the active settings section", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const settingsTab = screen.getByRole("tab", { name: /Settings/i });
    await user.click(settingsTab);

    await waitFor(() => {
      const generalButton = screen.getByRole("button", { name: /^General$/i });
      expect(generalButton).toHaveClass("active");
    });

    const environmentsButton = screen.getByRole("button", { name: /^Environments$/i });
    await user.click(environmentsButton);

    await waitFor(() => {
      expect(environmentsButton).toHaveClass("active");
      const generalButton = screen.getByRole("button", { name: /^General$/i });
      expect(generalButton).not.toHaveClass("active");
    });
  });

  it("displays Security settings correctly", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const settingsTab = screen.getByRole("tab", { name: /Settings/i });
    await user.click(settingsTab);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Security$/i })).toBeInTheDocument();
    });

    const securityButton = screen.getByRole("button", { name: /^Security$/i });
    await user.click(securityButton);

    await waitFor(() => {
      expect(screen.getByText("Manage security settings and vulnerability alerts")).toBeInTheDocument();
      expect(screen.getByText("Vulnerability Alerts")).toBeInTheDocument();
      expect(screen.getByText("Code Scanning")).toBeInTheDocument();
    });
  });
});


