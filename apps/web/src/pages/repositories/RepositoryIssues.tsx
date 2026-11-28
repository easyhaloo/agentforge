import { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, List, User, MessageSquare } from "lucide-react";
import { Button, SearchInput, Select } from "../../shared/ui";
import type { OrganizationSummary } from "../../shared/api/identity";
import { issuesAPI, type IssueListParams, type IssuePage } from "../../shared/api/issues";
import { translateError } from "../../shared/api/errors";
import { useDateFormatting } from "../../shared/i18n/format";
import { issueTemplatePath, issueDetailPath } from "../../shared/routing";
import "./repositories.css";

type IssueFilterType = "open" | "closed" | "all" | "assigned" | "created";

interface RepositoryIssuesProps {
  organization: OrganizationSummary;
  repository?: string;
  organizationHandle: string;
  currentUser: string;
}

export function RepositoryIssues({ organization, repository, organizationHandle, currentUser }: RepositoryIssuesProps) {
  const { t } = useTranslation("repositories");
  const { formatDateTime, formatRelativeTime } = useDateFormatting();
  const [searchParams, setSearchParams] = useSearchParams();
  const state = searchParams.get("state");
  const activeFilter: IssueFilterType = state === "closed" || state === "all" || state === "assigned" || state === "created" ? state : "open";
  const searchQuery = searchParams.get("q") ?? "";

  const [result, setResult] = useState<IssuePage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requestVersion, setRequestVersion] = useState(0);
  const [searchDraft, setSearchDraft] = useState(searchQuery);
  const composing = useRef(false);
  const [authorFilter, setAuthorFilter] = useState("");
  const [labelFilter, setLabelFilter] = useState("");
  const [milestoneFilter, setMilestoneFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [sort, setSort] = useState("updated-desc");
  const [page, setPage] = useState(1);
  const perPage = 30;

  const [previousParams, setPreviousParams] = useState(searchParams);
  if (searchParams !== previousParams) {
    setPreviousParams(searchParams);
    setSearchDraft(searchQuery);
    setPage(1);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    const [sortBy, direction] = sort.split("-") as [IssueListParams["sort"], IssueListParams["direction"]];
    const params: IssueListParams = {
      repository,
      include_filter_options: Boolean(repository),
      state: activeFilter === "open" || activeFilter === "closed" ? activeFilter : undefined,
      created_by: activeFilter === "created" ? currentUser : authorFilter,
      assignee: activeFilter === "assigned" ? currentUser : assigneeFilter,
      labels: labelFilter,
      milestone: milestoneFilter,
      q: searchQuery.trim(),
      sort: sortBy,
      direction,
      limit: perPage,
      offset: (page - 1) * perPage,
    };

    void issuesAPI.list(organization.id, params).then((data) => {
      if (active) setResult(data);
    }).catch((cause) => {
      if (!active) return;
      setResult(undefined);
      setError(translateError(cause, t, "repositories:issues.loadFailed"));
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [organization.id, repository, activeFilter, searchQuery, authorFilter, labelFilter, milestoneFilter, assigneeFilter, sort, page, currentUser, requestVersion, t]);

  const issues = result?.items ?? [];
  const totalIssues = result?.total ?? 0;
  const openCount = result?.open_total ?? 0;
  const closedCount = result?.closed_total ?? 0;

  function options(placeholder: string, values: string[], selected: string) {
    const unique = [...new Set([...values, selected].filter(Boolean))].sort();
    return [{ label: placeholder, value: "" }, ...unique.map((value) => ({ label: value, value }))];
  }

  function changeFilter(update: (value: string) => void, value: string) {
    setPage(1);
    update(value);
  }

  function paramsWithQuery(value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set("q", value);
    else params.delete("q");
    return params;
  }

  function changeQuery(value: string) {
    if (value === searchQuery) return;
    // Apply the URL before a new input event can update the draft.
    setSearchParams(paramsWithQuery(value), { replace: true, preventScrollReset: true, flushSync: true });
  }

  function changeState(next: IssueFilterType) {
    setPage(1);
    const params = paramsWithQuery(searchDraft);
    if (next === "open") params.delete("state");
    else params.set("state", next);
    setSearchParams(params, { flushSync: true });
  }

  return (
    <div className="issues-tab-content">
      <div className="issues-tab-layout">
        <aside className="issues-sidebar">
          <nav className="issues-nav" aria-label={t("issues.views")}>
            <Button
              onClick={() => changeState(activeFilter === "all" ? "all" : "open")}
              aria-pressed={activeFilter === "open" || activeFilter === "closed" || activeFilter === "all"}
              variant="ghost"
              className="af-action-row issues-nav-item"
            >
              <List size={16} aria-hidden="true" />
              {t("issues.allIssues")}
            </Button>
            {currentUser && (
              <>
                <Button
                  onClick={() => changeState("assigned")}
                  aria-pressed={activeFilter === "assigned"}
                  variant="ghost"
                  className="af-action-row issues-nav-item"
                >
                  <User size={16} aria-hidden="true" />
                  <span>{t("issues.assignedToMe")}</span>
                </Button>
                <Button
                  onClick={() => changeState("created")}
                  aria-pressed={activeFilter === "created"}
                  variant="ghost"
                  className="af-action-row issues-nav-item"
                >
                  <User size={16} aria-hidden="true" />
                  <span>{t("issues.createdByMe")}</span>
                </Button>
              </>
            )}
          </nav>
        </aside>
        <div className="issues-main">
          <div className="issues-header">
            {repository && <h2>{t("sections.issues")}</h2>}
            {repository && organization.role !== "viewer" && <Link to={issueTemplatePath(organizationHandle, repository)} className="af-button af-button--primary af-button--middle">
              {t("issues.newIssue")}
            </Link>}
          </div>
          <div
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={(event) => {
              composing.current = false;
              if (event.target instanceof HTMLInputElement) changeQuery(event.target.value);
            }}
          >
            <SearchInput
              value={searchDraft}
              onChange={(value) => {
                setSearchDraft(value);
                if (!value && !composing.current) changeQuery(value);
              }}
              onSearch={(value) => {
                // SearchInput trims submissions. Keep the original text in the URL.
                if (!composing.current && value === searchDraft.trim()) changeQuery(searchDraft);
              }}
              placeholder={t("issues.searchPlaceholder")}
              qualifiers={{ enabled: true }}
              clearButtonStyle="filled"
              submitButton
            />
          </div>
          <section className="issues-results" aria-label={t("issues.results")} aria-busy={loading}>
            <div className="issues-toolbar">
              <div className="issues-states">
                <Button className="issues-state" size="small" aria-pressed={activeFilter === "all"} onClick={() => changeState("all")}>
                  {t("issues.allStates")} <span className="issue-count">{openCount + closedCount}</span>
                </Button>
                <Button className="issues-state" size="small" aria-pressed={activeFilter === "open"} onClick={() => changeState("open")}>
                  <AlertCircle size={16} aria-hidden="true" />
                  {t("issues.openIssues")} <span className="issue-count">{openCount}</span>
                </Button>
                <Button className="issues-state" size="small" aria-pressed={activeFilter === "closed"} onClick={() => changeState("closed")}>
                  <CheckCircle2 size={16} aria-hidden="true" />
                  {t("issues.closedIssues")} <span className="issue-count">{closedCount}</span>
                </Button>
              </div>
              <div className="issues-filters">
                {repository && <>
                  <Select
                    aria-label={t("issues.filterByAuthor")}
                    placeholder={t("issues.author")}
                    value={activeFilter === "created" ? currentUser : authorFilter}
                    disabled={activeFilter === "created"}
                    onChange={(event) => changeFilter(setAuthorFilter, event.target.value)}
                    options={options(t("issues.author"), result?.filter_options?.authors ?? [], activeFilter === "created" ? currentUser : authorFilter)}
                  />
                  <Select
                    aria-label={t("issues.filterByLabel")}
                    placeholder={t("issues.label")}
                    value={labelFilter}
                    onChange={(event) => changeFilter(setLabelFilter, event.target.value)}
                    options={options(t("issues.label"), result?.filter_options?.labels ?? [], labelFilter)}
                  />
                  <Select
                    aria-label={t("issues.filterByMilestone")}
                    placeholder={t("issues.milestone")}
                    value={milestoneFilter}
                    onChange={(event) => changeFilter(setMilestoneFilter, event.target.value)}
                    options={options(t("issues.milestone"), result?.filter_options?.milestones ?? [], milestoneFilter)}
                  />
                  <Select
                    aria-label={t("issues.filterByAssignee")}
                    placeholder={t("issues.assignee")}
                    value={activeFilter === "assigned" ? currentUser : assigneeFilter}
                    disabled={activeFilter === "assigned"}
                    onChange={(event) => changeFilter(setAssigneeFilter, event.target.value)}
                    options={options(t("issues.assignee"), result?.filter_options?.assignees ?? [], activeFilter === "assigned" ? currentUser : assigneeFilter)}
                  />
                </>}
                <Select
                  aria-label={t("issues.sortBy")}
                  value={sort}
                  onChange={(event) => changeFilter(setSort, event.target.value)}
                  options={[
                    { label: t("issues.recentlyUpdated"), value: "updated-desc" },
                    { label: t("issues.newest"), value: "created-desc" },
                    { label: t("issues.oldest"), value: "created-asc" },
                    { label: t("issues.mostCommented"), value: "comments-desc" },
                  ]}
                />
              </div>
            </div>
            {loading ? (
              <p role="status" className="issues-message">{t("common:components.loading")}</p>
            ) : error ? (
              <div className="issues-message">
                <p role="alert" className="org-error">{error}</p>
                <Button variant="secondary" onClick={() => setRequestVersion(version => version + 1)}>{t("app:organizationGate.retry")}</Button>
              </div>
            ) : issues.length === 0 ? (
              <p className="issues-message">{t("issues.noIssues")}</p>
            ) : (
              <ul className="issues-list" role="list">
                {issues.map((issue) => (
                  <li key={issue.id} className="issue-list-item">
                    {issue.state === "open" ? (
                      <AlertCircle size={16} className="issue-icon-open" role="img" aria-label={t("issues.state.open")} aria-hidden={activeFilter === "all"} />
                    ) : (
                      <CheckCircle2 size={16} className="issue-icon-closed" role="img" aria-label={t("issues.state.closed")} aria-hidden={activeFilter === "all"} />
                    )}
                    <div className="issue-title-cell">
                      <div className="issue-title-row">
                        <Link className="repo-link issue-title-link" to={issueDetailPath(organizationHandle, issue.repository, issue.number)}>{issue.title}</Link>
                        {issue.issue_type && <span className="issue-label">{t(`issues.type.${issue.issue_type}`)}</span>}
                        {issue.labels.map((label) => (
                          <span key={label.id} className="issue-label" style={{ borderColor: `#${label.color}` }}>{label.name}</span>
                        ))}
                      </div>
                      <div className="issue-meta-row">
                        <span>{!repository && issue.repository}#{issue.number}</span>
                        {activeFilter === "all" && <span>{t(issue.state === "open" ? "issues.state.open" : "issues.state.closed")}</span>}
                        <span>{issue.created_by}</span>
                        <time dateTime={issue.updated_at} title={formatDateTime(issue.updated_at)}>{formatRelativeTime(issue.updated_at)}</time>
                        {issue.assignees.length > 0 && (
                          <span className="issue-assignee" title={t("issues.assignees")}>
                            <User size={14} aria-hidden="true" />
                            {issue.assignees[0].user_id}{issue.assignees.length > 1 && ` +${issue.assignees.length - 1}`}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="issue-comments" role="img" aria-label={t("issues.detail.commentCount", { count: issue.comments })}>
                      <MessageSquare size={14} aria-hidden="true" />
                      {issue.comments}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {!loading && !error && <div className="issues-footer">
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
          </div>}
        </div>
      </div>
    </div>
  );
}
