import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { OrganizationSummary, RepositoryPreviewTree, RepositoryPreviewBlob } from "../../shared/api/identity";
import { repositoryPreviewAPI } from "../../shared/api/identity";
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
  beforeAll(async () => {
    await i18n.changeLanguage("en-US");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repositoryPreviewAPI.tree).mockResolvedValue(mockTreeResponse);
  });

  it("switches to Issues tab when clicked", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

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
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

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
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

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
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const issuesTab = screen.getByRole("tab", { name: /Issues/i });
    await user.click(issuesTab);

    await waitFor(() => {
      expect(screen.getByText("Open issues")).toBeInTheDocument();
    });

    const assignedButton = screen.getByText("Assigned to me").closest("button");
    await user.click(assignedButton!);

    await waitFor(() => {
      expect(screen.getByText("Fix memory leak in agent executor")).toBeInTheDocument();
    });
  });

  it("filters issues created by current user", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const issuesTab = screen.getByRole("tab", { name: /Issues/i });
    await user.click(issuesTab);

    await waitFor(() => {
      expect(screen.getByText("Open issues")).toBeInTheDocument();
    });

    const createdButton = screen.getByText("Created by me").closest("button");
    await user.click(createdButton!);

    await waitFor(() => {
      expect(screen.getByText("Add support for custom authentication providers")).toBeInTheDocument();
      expect(screen.getByText("Add dark mode support to UI")).toBeInTheDocument();
    });
  });

  it("searches issues by title", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

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
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

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
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

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
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

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
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

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
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

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

  it("shows 'New issue' button", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

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
      expect(screen.getByText("opened by alice-dev")).toBeInTheDocument();
      expect(screen.getByText("opened by bob-eng")).toBeInTheDocument();
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

    await waitFor(() => {
      const authorSelect = document.querySelector(".filter-select");
      expect(authorSelect).toBeInTheDocument();
    });

    const authorSelects = document.querySelectorAll(".filter-select");
    const authorSelect = Array.from(authorSelects).find((select) =>
      select.querySelector("option[value='alice-dev']")
    ) as HTMLSelectElement;

    await user.selectOptions(authorSelect, "alice-dev");

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

    await waitFor(() => {
      const sortSelects = document.querySelectorAll(".filter-select");
      const sortSelect = Array.from(sortSelects).find((select) =>
        select.querySelector("option[value='newest']")
      );
      expect(sortSelect).toBeInTheDocument();
    });

    const prItems = document.querySelectorAll(".pr-item");
    expect(prItems[0]?.textContent).toContain("Add support for multi-agent coordination workflows");
  });

  it("sorts PRs by most commented", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const pullsTab = screen.getByRole("tab", { name: /Pull Requests/i });
    await user.click(pullsTab);

    await waitFor(() => {
      const sortSelects = document.querySelectorAll(".filter-select");
      expect(sortSelects.length).toBeGreaterThan(0);
    });

    const sortSelects = document.querySelectorAll(".filter-select");
    const sortSelect = Array.from(sortSelects).find((select) =>
      select.querySelector("option[value='most-commented']")
    ) as HTMLSelectElement;

    await user.selectOptions(sortSelect, "most-commented");

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
      expect(screen.getByText("enhancement")).toBeInTheDocument();
      expect(screen.getByText("bug")).toBeInTheDocument();
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("filters PRs by label", async () => {
    const user = userEvent.setup();
    render(<RepositoryDetailPage organization={mockOrganization} repositorySlug="testrepo" />);

    const pullsTab = screen.getByRole("tab", { name: /Pull Requests/i });
    await user.click(pullsTab);

    await waitFor(() => {
      const labelSelects = document.querySelectorAll(".filter-select");
      expect(labelSelects.length).toBeGreaterThan(0);
    });

    const labelSelects = document.querySelectorAll(".filter-select");
    const labelSelect = Array.from(labelSelects).find((select) =>
      select.querySelector("option[value='bug']")
    ) as HTMLSelectElement;

    await user.selectOptions(labelSelect, "bug");

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
      expect(screen.getByText("✓ Approved")).toBeInTheDocument();
      expect(screen.getByText("⚠ Changes requested")).toBeInTheDocument();
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
