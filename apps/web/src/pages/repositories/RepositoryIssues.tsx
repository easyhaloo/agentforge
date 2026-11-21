import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, Plus, User, MessageSquare } from "lucide-react";
import { Button, SearchInput, Select, DataTable, Modal } from "../../shared/ui";
import type { DataTableColumn } from "../../shared/ui";
import type { OrganizationSummary } from "../../shared/api/identity";
import { issuesAPI, type Issue, type IssueListParams, type IssueCreate, type IssueUpdate, type Assignee } from "../../shared/api/issues";
import { translateError } from "../../shared/api/errors";
import { issueDetailPath } from "../../shared/routing";
import { IssueForm } from "./IssueForm";
import "./repositories.css";

type IssueFilterType = "open" | "closed" | "assigned" | "created";

interface RepositoryIssuesProps {
  organization: OrganizationSummary;
  repository: string;
  organizationHandle: string;
  onNotify: (message: string) => void;
}

export function RepositoryIssues({ organization, repository, organizationHandle, onNotify }: RepositoryIssuesProps) {
  const { t } = useTranslation("repositories");
  const navigate = useNavigate();
  const currentUser = ""; // TODO: Get from account context

  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [totalIssues, setTotalIssues] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [activeFilter, setActiveFilter] = useState<IssueFilterType>("open");
  const [searchQuery, setSearchQuery] = useState("");
  const [authorFilter, setAuthorFilter] = useState("");
  const [labelFilter, setLabelFilter] = useState("");
  const [milestoneFilter, setMilestoneFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [sortBy, setSortBy] = useState<"created" | "updated" | "comments">("updated");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const perPage = 30;

  // Fetch issues from API
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    const params: IssueListParams = {
      repository,
      state: activeFilter === "open" ? "open" : activeFilter === "closed" ? "closed" : "all",
      sort: sortBy,
      direction,
      page,
      per_page: perPage,
    };

    // Apply filters
    if (searchQuery.trim()) params.q = searchQuery.trim();
    if (authorFilter) params.creator = authorFilter;
    if (labelFilter) params.labels = labelFilter;
    if (milestoneFilter) params.milestone = milestoneFilter;
    if (assigneeFilter) params.assignee = assigneeFilter;

    // Handle special filters
    if (activeFilter === "assigned" && currentUser) {
      params.assignee = currentUser;
      params.state = "all";
    } else if (activeFilter === "created" && currentUser) {
      params.creator = currentUser;
      params.state = "all";
    }

    void issuesAPI
      .list(organization.id, params)
      .then((result) => {
        if (!active) return;
        setIssues(result.items);
        setTotalIssues(result.total);
        setLoading(false);
      })
      .catch((cause) => {
        if (!active) return;
        setError(translateError(cause, t, "repositories:issues.loadFailed"));
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    organization.id,
    repository,
    activeFilter,
    searchQuery,
    authorFilter,
    labelFilter,
    milestoneFilter,
    assigneeFilter,
    sortBy,
    direction,
    page,
    currentUser,
    t,
  ]);

  // Extract unique filter values from loaded issues
  const allAuthors = useMemo(
    () => Array.from(new Set(issues.map((issue) => issue.created_by))).sort(),
    [issues]
  );
  const allLabels = useMemo(
    () => Array.from(new Set(issues.flatMap((issue) => issue.labels.map((l) => l.name)))).sort(),
    [issues]
  );
  const allMilestones = useMemo(
    () =>
      Array.from(
        new Set(issues.map((issue) => issue.milestone_id).filter((m): m is string => m !== undefined))
      ).sort(),
    [issues]
  );
  const allAssignees = useMemo(
    () =>
      Array.from(
        new Set(issues.flatMap((issue) => issue.assignees.map((a) => a.user_id)))
      ).sort(),
    [issues]
  );

  const openCount = issues.filter((issue) => issue.state === "open").length;
  const closedCount = issues.filter((issue) => issue.state === "closed").length;

  const handleCreateIssue = async (data: IssueCreate | IssueUpdate) => {
    setBusy(true);
    setError("");
    try {
      const newIssue = await issuesAPI.create(organization.id, data as IssueCreate);
      setShowCreateModal(false);
      onNotify(t("issues.createSuccess"));
      // Navigate to the new issue
      navigate(issueDetailPath(organizationHandle, repository, newIssue.number));
    } catch (cause) {
      throw new Error(translateError(cause, t, "repositories:issues.createFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleRowClick = (issue: Issue) => {
    navigate(issueDetailPath(organizationHandle, repository, issue.number));
  };

  const columns: DataTableColumn<Issue>[] = [
    {
      key: "title",
      title: t("issues.title"),
      render: (_value, row) => (
        <div
          className="issue-title-cell issue-title-clickable"
          onClick={() => handleRowClick(row)}
          style={{ cursor: "pointer" }}
        >
          <div className="issue-title-row">
            {row.state === "open" ? (
              <AlertCircle size={16} className="issue-icon-open" />
            ) : (
              <CheckCircle2 size={16} className="issue-icon-closed" />
            )}
            <strong>{row.title}</strong>
          </div>
          <div className="issue-meta-row">
            <span className="issue-number">#{row.number}</span>
            {row.labels.length > 0 && (
              <div className="issue-labels">
                {row.labels.map((label) => (
                  <span
                    key={label.id}
                    className="issue-label"
                    style={{ backgroundColor: `#${label.color}` }}
                  >
                    {label.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "created_by",
      title: t("issues.author"),
      render: (value) => (
        <div className="issue-author">
          <User size={14} />
          <span>{String(value)}</span>
        </div>
      ),
    },
    {
      key: "assignees",
      title: t("issues.assignee"),
      render: (value) => {
        const assignees = value as Assignee[];
        return (
          <div className="issue-assignee">
            {assignees.length > 0 ? (
              <>
                <User size={14} />
                <span>{assignees[0].user_id}</span>
                {assignees.length > 1 && <span> +{assignees.length - 1}</span>}
              </>
            ) : (
              <span className="issue-unassigned">{t("issues.unassigned")}</span>
            )}
          </div>
        );
      },
    },
    {
      key: "comments",
      title: t("issues.comments"),
      render: (value) => (
        <div className="issue-comments">
          <MessageSquare size={14} />
          <span>{String(value)}</span>
        </div>
      ),
    },
    {
      key: "updated_at",
      title: t("issues.updated"),
      render: (value) => {
        const date = new Date(String(value));
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        let timeAgo = "";
        if (diffMins < 1) {
          timeAgo = t("issues.justNow");
        } else if (diffMins < 60) {
          timeAgo = t("issues.minutesAgo", { count: diffMins });
        } else if (diffHours < 24) {
          timeAgo = t("issues.hoursAgo", { count: diffHours });
        } else if (diffDays < 30) {
          timeAgo = t("issues.daysAgo", { count: diffDays });
        } else {
          timeAgo = date.toLocaleDateString();
        }

        return <span className="issue-date">{timeAgo}</span>;
      },
    },
  ];

  if (error) {
    return (
      <div className="issues-tab-content">
        <p role="alert" className="org-error">
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="issues-tab-content">
      <div className="issues-tab-layout">
        <aside className="issues-sidebar">
          <h3>{t("issues.filters")}</h3>
          <nav className="issues-nav">
            <Button
              onClick={() => setActiveFilter("open")}
              className={`issues-nav-item ${activeFilter === "open" ? "active" : ""}`}
            >
              <AlertCircle size={14} />
              <span>{t("issues.openIssues")}</span>
              <span className="issue-count">{openCount}</span>
            </Button>
            <Button
              onClick={() => setActiveFilter("closed")}
              className={`issues-nav-item ${activeFilter === "closed" ? "active" : ""}`}
            >
              <CheckCircle2 size={14} />
              <span>{t("issues.closedIssues")}</span>
              <span className="issue-count">{closedCount}</span>
            </Button>
            {currentUser && (
              <>
                <Button
                  onClick={() => setActiveFilter("assigned")}
                  className={`issues-nav-item ${activeFilter === "assigned" ? "active" : ""}`}
                >
                  <User size={14} />
                  <span>{t("issues.assignedToMe")}</span>
                </Button>
                <Button
                  onClick={() => setActiveFilter("created")}
                  className={`issues-nav-item ${activeFilter === "created" ? "active" : ""}`}
                >
                  <User size={14} />
                  <span>{t("issues.createdByMe")}</span>
                </Button>
              </>
            )}
          </nav>
        </aside>
        <main className="issues-main">
          <div className="issues-header">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              onSearch={setSearchQuery}
              placeholder={t("issues.searchPlaceholder")}
              className="issues-search"
            />
            <Button
              variant="primary"
              size="small"
              onClick={() => setShowCreateModal(true)}
            >
              <Plus size={14} />
              {t("issues.newIssue")}
            </Button>
          </div>
          <div className="issues-filters">
            <Select
              aria-label={t("issues.filterByAuthor")}
              placeholder={t("issues.author")}
              value={authorFilter}
              onChange={(event) => setAuthorFilter(event.target.value)}
              options={allAuthors.map((author) => ({ label: author, value: author }))}
            />
            <Select
              aria-label={t("issues.filterByLabel")}
              placeholder={t("issues.label")}
              value={labelFilter}
              onChange={(event) => setLabelFilter(event.target.value)}
              options={allLabels.map((label) => ({ label, value: label }))}
            />
            <Select
              aria-label={t("issues.filterByMilestone")}
              placeholder={t("issues.milestone")}
              value={milestoneFilter}
              onChange={(event) => setMilestoneFilter(event.target.value)}
              options={allMilestones.map((milestone) => ({ label: milestone, value: milestone }))}
            />
            <Select
              aria-label={t("issues.filterByAssignee")}
              placeholder={t("issues.assignee")}
              value={assigneeFilter}
              onChange={(event) => setAssigneeFilter(event.target.value)}
              options={allAssignees.map((assignee) => ({ label: assignee, value: assignee }))}
            />
            <Select
              aria-label={t("issues.sortBy")}
              value={`${sortBy}-${direction}`}
              onChange={(event) => {
                const [newSort, newDir] = event.target.value.split("-") as [
                  "created" | "updated" | "comments",
                  "asc" | "desc"
                ];
                setSortBy(newSort);
                setDirection(newDir);
              }}
              options={[
                { label: t("issues.recentlyUpdated"), value: "updated-desc" },
                { label: t("issues.newest"), value: "created-desc" },
                { label: t("issues.oldest"), value: "created-asc" },
                { label: t("issues.mostCommented"), value: "comments-desc" },
              ]}
            />
          </div>
          <div className="issues-table-wrap">
            {loading ? (
              <p role="status">{t("common:components.loading")}</p>
            ) : (
              <DataTable
                columns={columns}
                data={issues}
                rowKey="id"
                showColumnVisibility={false}
                emptyText={t("issues.noIssues")}
              />
            )}
          </div>
          <div className="issues-footer">
            <span>
              {t("issues.showingCount", { count: issues.length, total: totalIssues })}
            </span>
            {totalIssues > perPage && (
              <div className="issues-pagination">
                <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  {t("common:actions.previous")}
                </Button>
                <span>
                  {t("issues.page", { current: page, total: Math.ceil(totalIssues / perPage) })}
                </span>
                <Button
                  disabled={page >= Math.ceil(totalIssues / perPage)}
                  onClick={() => setPage(page + 1)}
                >
                  {t("common:actions.next")}
                </Button>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Create Issue Modal */}
      {showCreateModal && (
        <Modal
          open={showCreateModal}
          onCancel={() => setShowCreateModal(false)}
          title={t("issues.createIssue")}
        >
          <IssueForm
            mode="create"
            repository={repository}
            onSubmit={handleCreateIssue}
            onCancel={() => setShowCreateModal(false)}
            busy={busy}
          />
        </Modal>
      )}
    </div>
  );
}
