import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, MessageSquare, Plus, User } from "lucide-react";
import { translateError } from "../../shared/api/errors";
import { type OrganizationSummary } from "../../shared/api/identity";
import { issuesAPI, type Issue, type IssuePage } from "../../shared/api/issues";
import { formatDateTime, formatRelativeTime } from "../../shared/i18n/format";
import { Button, DataTable, Input, Modal, SearchInput, Select, TextArea, type DataTableColumn } from "../../shared/ui";
import "./RepositoryDetailPage.css";

const filters = ["open", "closed", "assigned", "created"] as const;
const sortOptions = ["updated", "newest", "oldest", "comments"] as const;
const pageSize = 20;

type Props = { organization: OrganizationSummary; repository: string; userId: string; displayName?: string };

export function RepositoryIssues({ organization, repository, userId, displayName }: Props) {
  const { t } = useTranslation("repositories");
  const { t: translate } = useTranslation();
  const [filter, setFilter] = useState<typeof filters[number]>("open");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [author, setAuthor] = useState("");
  const [label, setLabel] = useState("");
  const [assignee, setAssignee] = useState("");
  const [milestone, setMilestone] = useState("");
  const [sort, setSort] = useState<typeof sortOptions[number]>("updated");
  const [offset, setOffset] = useState(0);
  const [revision, refresh] = useState(0);
  const [result, setResult] = useState<IssuePage>();
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [create, setCreate] = useState(false);
  const [selected, selectIssue] = useState<number>();
  const open = result?.open_total;
  const closed = result?.closed_total;
  const names = (id: string) => id === userId && displayName ? displayName : id;

  useEffect(() => {
    const controller = new AbortController();
    setListState("loading");
    void issuesAPI.list(organization.id, {
      repository, state: filter === "open" || filter === "closed" ? filter : undefined,
      created_by: filter === "created" ? userId : author,
      assignee: filter === "assigned" ? userId : assignee,
      labels: label, milestone, q: query,
      sort: sort === "oldest" || sort === "newest" ? "created" : sort,
      direction: sort === "oldest" ? "asc" : "desc",
      limit: pageSize, offset, include_filter_options: true,
    }, controller.signal).then(page => {
      if (controller.signal.aborted) return;
      setResult(page);
      if (offset > 0 && offset >= page.total) setOffset(Math.max(0, Math.floor((page.total - 1) / pageSize) * pageSize));
      else setListState("ready");
    }).catch(cause => {
      if (controller.signal.aborted) return;
      setError(translateError(cause, translate, "repositories:issues.loadError"));
      setListState("error");
    });
    return () => controller.abort();
  }, [organization.id, repository, userId, filter, author, assignee, label, milestone, query, sort, offset, revision, translate]);

  const columns: DataTableColumn<Issue>[] = [
    { key: "title", title: t("issues.issue"), render: (_, row) => <div className="issue-title-cell">
      <div className="issue-title-row">
        {row.state === "open" ? <AlertCircle size={16} className="issue-icon-open"/> : <CheckCircle2 size={16} className="issue-icon-closed"/>}
        <Button variant="ghost" className="issue-title-button" onClick={() => selectIssue(row.number)}>{row.title}</Button>
      </div>
      <div className="issue-meta-row">
        <span className="issue-number">#{row.number}</span>
        {!!row.labels.length && <div className="issue-labels">{row.labels.map(item => <span key={item.id} className="issue-label">{item.name}</span>)}</div>}
      </div>
    </div> },
    { key: "created_by", title: t("issues.author"), render: (_, row) => <div className="issue-author"><User size={14}/>{names(row.created_by)}</div> },
    { key: "assignees", title: t("issues.assignee"), render: (_, row) => row.assignees.length
      ? <div className="issue-assignee"><User size={14}/>{row.assignees.map(item => names(item.user_id)).join(", ")}</div>
      : <span className="issue-unassigned">{t("issues.unassigned")}</span> },
    { key: "comments", title: t("issues.comments"), render: (_, row) => <div className="issue-comments"><MessageSquare size={14}/>{row.comments}</div> },
    { key: "updated_at", title: t("issues.updatedColumn"), render: (_, row) => <time className="issue-date" dateTime={row.updated_at} title={formatDateTime(row.updated_at)}>{formatRelativeTime(row.updated_at)}</time> },
  ];

  const changeFilter = (setter: (value: string) => void) => (event: React.ChangeEvent<HTMLSelectElement>) => {
    setter(event.target.value);
    setOffset(0);
  };
  const choices = (values: string[] = [], title: (value: string) => string = value => value) =>
    values.map(value => ({ label: title(value), value }));
  const filterOptions = result?.filter_options;
  const reload = () => refresh(value => value + 1);
  return <div className="issues-tab-content">
    <div className="issues-tab-layout">
      <aside className="issues-sidebar">
        <h3>{t("issues.filters")}</h3>
        <nav className="issues-nav" aria-label={t("issues.filters")}>
          {filters.map(item => {
            const Icon = item === "open" ? AlertCircle : item === "closed" ? CheckCircle2 : User;
            const count = item === "open" ? open : item === "closed" ? closed : undefined;
            return <Button key={item} onClick={() => { setFilter(item); setOffset(0); }}
              disabled={!userId && (item === "assigned" || item === "created")}
              aria-pressed={filter === item} className={`issues-nav-item ${filter === item ? "active" : ""}`}>
              <Icon size={14} aria-hidden="true"/><span>{t(`issues.${item}`)}</span>
              {count !== undefined && <span className="issue-count">{count}</span>}
            </Button>;
          })}
        </nav>
      </aside>
      <div className="issues-main">
        <div className="issues-header">
          <SearchInput value={search} onChange={setSearch} onSearch={value => { setQuery(value); setOffset(0); }} placeholder={t("issues.search")} className="issues-search"/>
          <Button variant="primary" size="small" disabled={organization.role === "viewer"} onClick={() => setCreate(true)}>
            <Plus size={14} aria-hidden="true"/>{t("issues.newIssue")}
          </Button>
        </div>
        <div className="issues-filters">
          <Select aria-label={t("issues.filterAuthor")} placeholder={t("issues.author")} value={filter === "created" ? userId : author}
            disabled={filter === "created"} onChange={changeFilter(setAuthor)} options={choices(filterOptions?.authors, names)}/>
          <Select aria-label={t("issues.filterLabel")} placeholder={t("issues.label")} value={label} onChange={changeFilter(setLabel)} options={choices(filterOptions?.labels)}/>
          <Select aria-label={t("issues.projectUnavailable")} placeholder={t("issues.project")} options={[]} disabled />
          <Select aria-label={t("issues.filterMilestone")} placeholder={t("issues.milestone")} value={milestone} onChange={changeFilter(setMilestone)} options={choices(filterOptions?.milestones)}/>
          <Select aria-label={t("issues.filterAssignee")} placeholder={t("issues.assignee")} value={filter === "assigned" ? userId : assignee}
            disabled={filter === "assigned"} onChange={changeFilter(setAssignee)} options={choices(filterOptions?.assignees, names)}/>
          <Select aria-label={t("issues.sort")} value={sort} onChange={event => { setSort(event.target.value as typeof sort); setOffset(0); }}
            options={sortOptions.map(value => ({ value, label: t(`issues.${value === "updated" ? "recentlyUpdated" : value === "comments" ? "mostCommented" : value}`) }))}/>
        </div>
        {listState === "loading" && <p role="status">{t("issues.loading")}</p>}
        {listState === "error" && <p role="alert" className="org-error">{error} <Button onClick={reload}>{t("issues.retry")}</Button></p>}
        {listState === "ready" && result && <>
          <div className="issues-table-wrap">
            <DataTable columns={columns} data={result.items} rowKey="id" showColumnVisibility={false} emptyText={t("issues.empty")}/>
          </div>
          <div className="issues-footer">
            <span>{t("issues.showing", { count: result.items.length, total: result.open_total + result.closed_total })}</span>
            {(offset > 0 || result.total > pageSize) && <span>
              <Button size="small" disabled={offset === 0} onClick={() => setOffset(offset - pageSize)}>{translate("common:actions.previous")}</Button>
              <Button size="small" disabled={offset + pageSize >= result.total} onClick={() => setOffset(offset + pageSize)}>{translate("common:actions.next")}</Button>
            </span>}
          </div>
        </>}
      </div>
    </div>
    {create && <IssueEditor onCancel={() => setCreate(false)} onSave={async (title, body) => {
      const issue = await issuesAPI.create(organization.id, { repository, title, body });
      setCreate(false);
      selectIssue(issue.number);
      reload();
    }}/>}
    {selected !== undefined && <IssueDetails key={selected} organization={organization} repository={repository} userId={userId}
      displayName={displayName} number={selected} onClose={() => selectIssue(undefined)} onChange={reload}/>}
  </div>;
}

function IssueEditor({ issue, onCancel, onSave }: {
  issue?: Issue; onCancel: () => void; onSave: (title: string, body: string) => Promise<void>;
}) {
  const { t } = useTranslation("repositories");
  const { t: translate } = useTranslation();
  const [title, setTitle] = useState(issue?.title ?? "");
  const [body, setBody] = useState(issue?.body ?? "");
  const [error, setError] = useState("");
  return <Modal open title={t(issue ? "issues.editIssue" : "issues.newIssue")} onCancel={onCancel} okDisabled={!title.trim()}
    okText={t(issue ? "issues.save" : "issues.createIssue")} onOk={async () => {
      setError("");
      try { await onSave(title.trim(), body.trim()); }
      catch (cause) { setError(translateError(cause, translate, "repositories:issues.saveError")); }
    }}>
    <div className="repo-register-fields">
      <Input label={t("issues.title")} value={title} onChange={event => setTitle(event.target.value)} required />
      <TextArea label={t("issues.description")} rows={5} value={body} onChange={event => setBody(event.target.value)}/>
      {error && <p role="alert" className="org-error">{error}</p>}
    </div>
  </Modal>;
}

function IssueDetails({ organization, repository, userId, displayName, number, onClose, onChange }: Props & {
  number: number; onClose: () => void; onChange: () => void;
}) {
  const { t } = useTranslation("repositories");
  const { t: translate } = useTranslation();
  const [issue, setIssue] = useState<Issue>();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void issuesAPI.get(organization.id, number, repository, controller.signal).then(issue => {
      if (!controller.signal.aborted) setIssue(issue);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(translateError(cause, translate, "repositories:issues.loadError"));
    });
    return () => controller.abort();
  }, [organization.id, repository, number, translate, refresh]);
  if (issue && editing) return <IssueEditor issue={issue} onCancel={() => setEditing(false)} onSave={async (title, body) => {
    setIssue(await issuesAPI.update(organization.id, number, repository, { title, body }));
    setEditing(false);
    onChange();
  }}/>;
  const canEdit = issue && organization.role !== "viewer" &&
    (issue.created_by === userId || organization.role === "owner" || organization.role === "admin");
  return <Modal open title={issue ? `${issue.title} #${number}` : `#${number}`} cancelText={t("issues.dismiss")} onCancel={onClose} confirmLoading={busy}>
    {error && <p role="alert" className="org-error">{error} <Button onClick={() => setRefresh(value => value + 1)}>{t("issues.retry")}</Button></p>}
    {!issue && !error && <p role="status">{t("issues.loading")}</p>}
    {issue && <>
      <p className="repo-meta">{t(issue.state === "open" ? "issues.openStatus" : "issues.closedStatus")} · {issue.created_by === userId && displayName ? displayName : issue.created_by}</p>
      <p className="issue-description-body">{issue.body || t("issues.noDescription")}</p>
      {canEdit && <div className="repo-toolbar">
        <Button disabled={busy} onClick={() => setEditing(true)}>{t("issues.editIssue")}</Button>
        <Button disabled={busy} onClick={async () => {
          setError("");
          setBusy(true);
          try {
            setIssue(await (issue.state === "open" ? issuesAPI.close(organization.id, number, repository, "completed")
              : issuesAPI.reopen(organization.id, number, repository)));
            onChange();
          } catch (cause) {
            setError(translateError(cause, translate, "repositories:issues.saveError"));
          } finally {
            setBusy(false);
          }
        }}>{t(issue.state === "open" ? "issues.closeIssue" : "issues.reopenIssue")}</Button>
      </div>}
    </>}
  </Modal>;
}
