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
      expect(screen.getByText("Issue")).toBeInTheDocument();
      expect(screen.getByText("Author")).toBeInTheDocument();
      expect(screen.getByText("Assignee")).toBeInTheDocument();
      expect(screen.getByText("Comments")).toBeInTheDocument();
      expect(screen.getByText("Updated")).toBeInTheDocument();
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
