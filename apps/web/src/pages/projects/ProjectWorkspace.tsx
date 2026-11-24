import { Archive, ArrowLeft, CalendarRange, Columns3, Download, Plus, Settings, Table2 } from "lucide-react";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { APIError, translateError } from "../../shared/api/errors";
import type { OrganizationSummary } from "../../shared/api/identity";
import { projectFieldsAPI, type ProjectField } from "../../shared/api/projectFields";
import { projectPriorities, projectsAPI, projectStatuses, type Project, type ProjectItem, type ProjectProgress, type ProjectStatusDay, type ProjectView } from "../../shared/api/projects";
import { issueCreatePath, organizationHandle, orgPath, projectPath } from "../../shared/routing";
import { Button, DataTable, Input, Select, type DataTableColumn } from "../../shared/ui";
import { ProjectFieldSettings } from "./ProjectCustomFields";
import { ProjectFormPage } from "./ProjectForms";
import { filterProjectItems, groupProjectItems, projectCsv, projectItemSource, sortProjectItems } from "./projectViews";

const layoutIcons = { table: Table2, board: Columns3, roadmap: CalendarRange };
const primaryLink = "af-button af-button--primary af-button--middle";
const secondaryLink = "af-button af-button--secondary af-button--middle";

function customFieldLabel(field: ProjectField, item: ProjectItem) {
  const value = item.field_values?.[field.id];
  return field.options.find(({ id }) => id === value)?.name ?? value;
}

export function ProjectDetailPage({ organization, number }: { organization: OrganizationSummary; number: string }) {
  const { t } = useTranslation("repositories");
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project>();
  const [fields, setFields] = useState<ProjectField[]>([]);
  const [fieldsFailed, setFieldsFailed] = useState(false);
  const [items, setItems] = useState<ProjectItem[]>();
  const [error, setError] = useState("");
  const [itemError, setItemError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [pendingItem, setPendingItem] = useState("");
  const handle = organizationHandle(organization);
  const orgID = organization.id;
  const base = projectPath(handle, number);
  const admin = organization.role === "owner" || organization.role === "admin";
  const writer = organization.role !== "viewer";
  const page = params.get("page") ?? "";
  const archived = page === "archive";
  const itemID = params.get("item") ?? "";
  const currentView = params.get("view") ?? "";
  const initialStatus = projectStatuses.find((value) => value === params.get("status"));
  const initialPriority = (["", ...projectPriorities] as const).find((value) => value === params.get("priority"));
  const viewURL = currentView ? `${base}?${new URLSearchParams({ view: currentView })}` : base;
  function pageURL(nextPage: string, extra?: Record<string, string>) {
    const query = new URLSearchParams({ ...(currentView && { view: currentView }), page: nextPage, ...extra });
    return `${base}?${query}`;
  }
  const form = ["add", "item", "settings", "view-new", "view-edit", "view-copy", "update-new", "fields", "workflows"].includes(page);
  const loadItems = (!form && page !== "about" && page !== "updates") || page === "item" || page === "add";
  const itemArchive = archived || params.get("archived") === "true";

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    projectsAPI.get(orgID, number, controller.signal).then((data) => {
      if (!controller.signal.aborted) setProject(data);
    }, (cause) => {
      if (!controller.signal.aborted) setError(cause instanceof APIError && cause.status === 404 ? t("projects.notFound") : translateError(cause, t, "issues.projects.loadFailed"));
    });
    return () => controller.abort();
  }, [orgID, number, attempt, t]);

  useEffect(() => {
    if (!project || !loadItems) return;
    const controller = new AbortController();
    setItems(undefined);
    setItemError("");
    projectsAPI.items(orgID, project.number, itemArchive, controller.signal).then((data) => {
      if (!controller.signal.aborted) setItems(data);
    }, (cause) => {
      if (!controller.signal.aborted) setItemError(translateError(cause, t, "issues.projects.loadFailed"));
    });
    return () => controller.abort();
  }, [orgID, project, loadItems, itemArchive, attempt, t]);

  const showFields = !form && (page === "" || archived || page === "insights");
  const projectVersion = project?.version;
  useEffect(() => {
    if (!showFields || !projectVersion) return;
    const controller = new AbortController();
    projectFieldsAPI.list(orgID, Number(number), controller.signal).then(({ fields }) => {
      if (!controller.signal.aborted) { setFields(fields); setFieldsFailed(false); }
    }, () => {
      if (!controller.signal.aborted) setFieldsFailed(true);
    });
    return () => controller.abort();
  }, [orgID, number, projectVersion, showFields, attempt]);

  const writable = writer && !project?.closed;
  const editViews = admin && writable;
  const views = project?.views?.length ? project.views : [{ id: "default", name: "", layout: project?.layout ?? "table", filter: "", sort: "manual", group: project?.layout === "board" ? "status" : "none" } satisfies ProjectView];
  const view = views.find(({ id }) => id === currentView) ?? views[0];
  const [filter, setFilter] = useState<{ view: ProjectView; value: string }>();
  const search = filter?.view === view ? filter.value : view.filter;
  const visible = sortProjectItems(filterProjectItems(items ?? [], archived ? "" : search), archived ? "manual" : view.sort);
  const repository = project?.default_repository || project?.repository;

  function exportItems() {
    const csv = projectCsv([
      [["itemTitle", "source", "statusLabel", "priority", "iteration", "startDate", "targetDate"].map((key) => t(`projects.${key}`)), fields.map(({ name }) => name)].flat(),
      ...visible.map((item) => [item.title, projectItemSource(handle, item) ?? "", item.status ? t(`projects.status.${item.status}`) : "",
        item.priority?.toUpperCase() ?? "", item.iteration ?? "", item.start_date ?? "", item.target_date ?? "", ...fields.map((field) => String(customFieldLabel(field, item) ?? ""))]),
    ]);
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `project-${number}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function moveItem(item: ProjectItem, value: string) {
    if (!project || pendingItem || !writable) return;
    setPendingItem(item.id);
    setItemError("");
    try {
      const patch = view.group === "priority" ? { priority: value as ProjectItem["priority"] } : { status: value as ProjectItem["status"] };
      const changed = await projectsAPI.updateItem(orgID, project.number, item.id, { ...patch, version: item.version });
      setItems((current) => current?.map((entry) => entry.id === changed.id ? changed : entry));
    } catch (cause) {
      setItemError(translateError(cause, t, "projects.saveFailed"));
    } finally {
      setPendingItem("");
    }
  }

  return <section className={`projects-page${form ? " projects-create-page" : ""}`}>
    <Link className="projects-back" to={form || page ? viewURL : orgPath(handle, "projects")}><ArrowLeft size={16} aria-hidden /> {t(form || page ? "projects.backToProject" : "projects.back")}</Link>
    {error ? <div className="projects-message"><p role="alert">{error}</p><Button onClick={() => setAttempt(attempt + 1)}>{t("issues.composer.retry")}</Button></div> : !project ?
      <p role="status">{t("common:components.loading")}</p> : page === "fields" ? <ProjectFieldSettings orgID={orgID} projectNumber={project.number} projectVersion={project.version}
        canManage={editViews} fieldsURL={pageURL("fields")} fieldID={params.get("field") ?? undefined}
        onProjectVersionChange={(version) => setProject((current) => current && { ...current, version })}
        onRefresh={() => setAttempt((value) => value + 1)} /> : form ? <ProjectFormPage key={`${page}/${currentView}/${itemID}`} {...{
        organization, project, views, view, page, fieldsURL: pageURL("fields"), workflowsURL: pageURL("workflows"), item: items?.find(({ id }) => id === itemID), itemArchive, items, itemError, admin, writable, viewURL,
        initialRepository: params.get("repository") || repository || "", initialFilter: search, placement: { status: initialStatus, priority: initialPriority },
        retry: () => setAttempt((value) => value + 1),
        complete: (updated?: Project, to = viewURL) => { if (updated) setProject(updated); setAttempt((value) => value + 1); void navigate(to); },
        onItemVersionChange: (version: number) => setItems((current) => current?.map((item) => item.id === itemID ? { ...item, version } : item)),
      }} /> : <>
      <header className="projects-heading">
        <div><h1>{project.name} <span className="projects-number">#{project.number}</span></h1>
          {project.description && <p>{project.description}</p>}
          {project.closed && <p>{t("projects.closedNotice")}</p>}
        </div>
        <div className="projects-toolbar">
          <Link className={secondaryLink} to={pageURL("about")}>{t("projects.details")}</Link>
          <Link className={secondaryLink} to={pageURL("updates")}>{t("projects.updates")}</Link>
          <Link className={secondaryLink} to={pageURL("insights")}>{t("projects.insights")}</Link>
          <Link className={secondaryLink} to={pageURL("archive")}><Archive size={16} aria-hidden /> {t("projects.archive")}</Link>
          {admin && <Link className={secondaryLink} to={pageURL("workflows")}>{t("projects.workflows.title")}</Link>}
          {admin && <Link className={secondaryLink} to={pageURL("settings")}><Settings size={16} aria-hidden /> {t("projects.settings")}</Link>}
        </div>
      </header>
      {page === "about" ? <div className="projects-message projects-details">
        <h2>{t("projects.details")}</h2>
        {project.readme && <div className="repository-readme"><Markdown remarkPlugins={[remarkGfm]} skipHtml>{project.readme}</Markdown></div>}
        <dl><dt>{t("projects.owner")}</dt><dd>{organization.name}</dd>
          <dt>{t("projects.defaultRepository")}</dt><dd>{repository || t("projects.noDefault")}</dd>
          <dt>{t("projects.linkedRepositories")}</dt><dd>{project.repositories?.join(", ") || t("issues.projects.organizationWide")}</dd>
        </dl>
        <ProjectUpdates orgID={orgID} number={project.number} latest />
      </div> : page === "updates" ? <ProjectUpdates orgID={orgID} number={project.number} publishURL={writable ? pageURL("update-new") : undefined} /> : <>
        {archived ? <h2>{t("projects.archive")}</h2> : <>
          <nav className="projects-views" aria-label={t("projects.view")}>
            {views.map((candidate) => {
              const Icon = layoutIcons[candidate.layout];
              return <Link key={candidate.id} className="projects-view" to={`${base}?${new URLSearchParams({ view: candidate.id })}`} aria-current={candidate.id === view.id ? "page" : undefined}>
                <Icon size={16} aria-hidden /> {candidate.name || t(`projects.${candidate.layout}`)}
              </Link>;
            })}
            {editViews && <Link className="projects-view" to={pageURL("view-new")}><Plus size={16} aria-hidden /> {t("projects.newView")}</Link>}
          </nav>
          {currentView && !views.some(({ id }) => id === currentView) && <p role="status">{t("projects.viewUnavailable")}</p>}
          <div className="projects-toolbar projects-workspace-toolbar">
            <Input type="search" aria-label={t("projects.filter")} placeholder={t("projects.filterHint")} value={search} onChange={(event) => setFilter({ view, value: event.target.value })} />
            <Button disabled={!visible.length || fieldsFailed} onClick={exportItems}><Download size={16} aria-hidden /> {t("projects.export")}</Button>
            {editViews && <Link className={secondaryLink} to={pageURL("view-edit")}>{t("projects.viewOptions")}</Link>}
            {writable && <>
              <Link className={primaryLink} to={pageURL("add")}><Plus size={16} aria-hidden /> {t("projects.addItems")}</Link>
              {repository && <Link className={secondaryLink} to={`${issueCreatePath(handle, repository)}?${new URLSearchParams({ projects: `${handle}/${project.number}` })}`}>{t("projects.newIssue")}</Link>}
            </>}
          </div>
        </>}
        {showFields && fieldsFailed && <div className="projects-message"><p role="alert">{t("projectFields:loadFailed")}</p><Button onClick={() => setAttempt((value) => value + 1)}>{t("issues.composer.retry")}</Button></div>}
        {itemError && <div className="projects-message"><p role="alert">{itemError}</p><Button onClick={() => setAttempt(attempt + 1)}>{t("issues.composer.retry")}</Button></div>}
        {!items && !itemError && <p role="status">{t("common:components.loading")}</p>}
        {page === "insights" && items ? <><ProjectInsights items={visible} /><ProjectHistory orgID={orgID} number={project.number} /></> : items && (!visible.length && (archived || view.layout !== "board" || search.trim()) ? <div className="projects-message">
          <p>{t(items.length ? "projects.noMatchingItems" : archived ? "projects.noArchived" : "projects.noItems")}</p>
          {search && !archived && <Button onClick={() => setFilter({ view, value: "" })}>{t("projects.clearFilter")}</Button>}
        </div> : <ProjectItems {...{ handle, view, visible, fields, archived, writable, pendingItem, moveItem }}
          addItemsURL={(field, value) => pageURL("add", { [field]: value })}
          itemURL={(item) => pageURL("item", { item: item.id, ...(archived && { archived: "true" }) })} />)}
        {archived && items && <Button className="projects-back" onClick={() => setParams(currentView ? { view: currentView } : {})}>{t("projects.backToProject")}</Button>}
      </>}
    </>}
  </section>;
}

function ProjectUpdates({ orgID, number, latest, publishURL }: { orgID: string; number: number; latest?: boolean; publishURL?: string }) {
  const { t, i18n } = useTranslation("repositories");
  const [updates, setUpdates] = useState<ProjectProgress[]>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    projectsAPI.updates(orgID, number, controller.signal).then(setUpdates, (cause) => {
      if (!controller.signal.aborted) setError(translateError(cause, t, "projects.updatesFailed"));
    });
    return () => controller.abort();
  }, [orgID, number, attempt, t]);
  const formatDate = (date: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", ...(date.length === 10 && { timeZone: "UTC" }) }).format(new Date(date));
  return <section className="projects-updates">
    <div className="projects-toolbar"><h2>{t(latest ? "projects.latestUpdate" : "projects.updates")}</h2>
      {publishURL && <Link className={primaryLink} to={publishURL}><Plus size={16} aria-hidden /> {t("projects.newUpdate")}</Link>}
    </div>
    {error ? <div className="projects-message"><p role="alert">{error}</p><Button onClick={() => setAttempt((value) => value + 1)}>{t("issues.composer.retry")}</Button></div>
      : !updates ? <p role="status">{t("common:components.loading")}</p> : !updates.length ? <p>{t("projects.noUpdates")}</p>
        : (latest ? updates.slice(0, 1) : updates).map((update) => <article className="projects-message" key={update.id}>
          <h3>{t(`projects.updateStatus.${update.status}`)}</h3>
          <p>{update.author_name} · <time dateTime={update.created_at}>{formatDate(update.created_at)}</time></p>
          {update.start_date && <p>{t("projects.startDate")}: <time dateTime={update.start_date}>{formatDate(update.start_date)}</time></p>}
          {update.target_date && <p>{t("projects.targetDate")}: <time dateTime={update.target_date}>{formatDate(update.target_date)}</time></p>}
          <div className="repository-readme"><Markdown remarkPlugins={[remarkGfm]} skipHtml>{update.body}</Markdown></div>
        </article>)}
  </section>;
}

function ProjectItems({ visible, fields, view, handle, archived, writable, pendingItem, moveItem, itemURL, addItemsURL }: {
  visible: ProjectItem[]; fields: ProjectField[]; view: ProjectView; handle: string; archived: boolean; writable: boolean; pendingItem: string;
  moveItem: (item: ProjectItem, value: string) => Promise<void>; itemURL: (item: ProjectItem) => string;
  addItemsURL: (field: "status" | "priority", value: string) => string;
}) {
  const { t, i18n } = useTranslation("repositories");
  const group = view.layout === "board" && view.group === "none" ? "status" : view.group;
  const groups = groupProjectItems(visible, archived ? "none" : group);
  const [dragged, setDragged] = useState("");
  const fieldLabel = (field: "status" | "priority", value?: string) => !value ? t("projects.unset") : field === "priority" ? value.toUpperCase() : t(`projects.status.${value}`);
  const title = (item: ProjectItem) => <Link className="projects-item-title" to={itemURL(item)}>{item.title}</Link>;
  const source = (item: ProjectItem) => {
    const url = projectItemSource(handle, item);
    return url ? <Link to={url}>{item.repository}{item.number ? ` #${item.number}` : ` · ${t(`projects.kind.${item.kind}`)}`}</Link> : t(`projects.kind.${item.kind}`);
  };
  if (!archived && view.layout === "board") return <div className="projects-board" style={{ "--project-columns": groups.length } as React.CSSProperties}>
    {groups.map(([key, entries]) => <section key={key} aria-label={fieldLabel(group === "priority" ? "priority" : "status", key)}
      className={dragged && !entries.some(({ id }) => id === dragged) ? "projects-drop-target" : undefined}
      onDragOver={(event) => { if (dragged && writable && !pendingItem) event.preventDefault(); }}
      onDrop={(event) => {
        if (!dragged || !writable || pendingItem) return;
        event.preventDefault();
        const item = visible.find(({ id }) => id === dragged);
        setDragged("");
        if (item && !entries.some(({ id }) => id === dragged)) void moveItem(item, key);
      }}>
      <h2>{fieldLabel(group === "priority" ? "priority" : "status", key)} <span className="projects-number">{entries.length}</span></h2>
      <ul>{entries.map((item) => <li key={item.id} draggable={writable && !pendingItem} onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.id);
        setDragged(item.id);
      }} onDragEnd={() => setDragged("")}>{title(item)}<span>{source(item)}</span>
        {writable && <Select aria-label={t("projects.moveItem", { title: item.title })} value={key} disabled={Boolean(pendingItem)}
          options={(group === "priority" ? ["", ...projectPriorities] : projectStatuses).map((value) => ({ value, label: fieldLabel(group === "priority" ? "priority" : "status", value) }))}
          onChange={(event) => void moveItem(item, event.target.value)} />}
      </li>)}</ul>
      {writable && <Link className="projects-view" to={addItemsURL(group === "priority" ? "priority" : "status", key)}>
        <Plus size={16} aria-hidden /> {t("projects.addToColumn", { column: fieldLabel(group === "priority" ? "priority" : "status", key) })}
      </Link>}
    </section>)}
  </div>;

  if (!archived && view.layout === "roadmap") {
    const dates = visible.flatMap((item) => [item.start_date, item.target_date].filter((date): date is string => Boolean(date))).sort();
    const start = dates[0];
    const end = dates.at(-1);
    const range = start && end ? Date.parse(end) - Date.parse(start) : 0;
    const position = (date: string) => start && range ? 94 * (Date.parse(date) - Date.parse(start)) / range : 0;
    const formatDate = (date: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(date));
    return <div className="projects-table-scroll"><div className="projects-roadmap">
      <div className="projects-roadmap-row"><strong>{t("projects.itemTitle")}</strong><div className="projects-roadmap-dates">{start && <time dateTime={start}>{formatDate(start)}</time>}{end && end !== start && <time dateTime={end}>{formatDate(end)}</time>}</div></div>
      {visible.map((item) => {
        const from = item.start_date || item.target_date;
        const to = item.target_date || item.start_date;
        return <div className="projects-roadmap-row" key={item.id}>{title(item)}<div className="projects-roadmap-track">
          {from && to ? <><span className="projects-roadmap-bar" aria-hidden style={{ left: `${position(from)}%`, width: `${Math.max(6, position(to) - position(from))}%` }} />
            <span className="projects-roadmap-label">{formatDate(from)}{to !== from && ` – ${formatDate(to)}`}</span></> : <span>{t("projects.unscheduled")}</span>}
        </div></div>;
      })}
    </div></div>;
  }

  const columns: DataTableColumn<ProjectItem>[] = [
    { key: "title", title: t("projects.itemTitle"), render: (_, item) => title(item) },
    { key: "source", title: t("projects.source"), render: (_, item) => source(item) },
    { key: "status", title: t("projects.statusLabel"), render: (_, item) => fieldLabel("status", item.status) },
    { key: "priority", title: t("projects.priority"), render: (_, item) => fieldLabel("priority", item.priority) },
    { key: "iteration", title: t("projects.iteration"), render: (_, item) => item.iteration || "—" },
    { key: "start_date", title: t("projects.startDate"), render: (_, item) => item.start_date || "—" },
    { key: "target_date", title: t("projects.targetDate"), render: (_, item) => item.target_date || "—" },
    ...fields.map((field) => ({ key: field.id, title: field.name, render: (_: unknown, item: ProjectItem) => customFieldLabel(field, item) ?? "—" })),
  ];
  return <div className="projects-form">{groups.filter(([, entries]) => entries.length).map(([key, entries]) => <section key={key} className="projects-table-scroll">
    {group !== "none" && !archived && <h2 className="projects-group-heading">{fieldLabel(group, key)}</h2>}
    <DataTable data={entries} columns={columns} rowKey="id" className="projects-table" showColumnVisibility={false} />
  </section>)}</div>;
}

function ProjectInsights({ items }: { items: ProjectItem[] }) {
  const { t } = useTranslation("repositories");
  const iterations = new Map<string, number>();
  for (const item of items) {
    const key = item.iteration || t("projects.unset");
    iterations.set(key, (iterations.get(key) ?? 0) + 1);
  }
  return <div className="projects-insights">
    <section className="projects-message"><h2>{t("projects.statusLabel")}</h2>
      {groupProjectItems(items, "status").map(([key, entries]) => <div key={key} className="projects-insight-row">
        <span>{key ? t(`projects.status.${key}`) : t("projects.unset")}</span><meter max={items.length || 1} value={entries.length} aria-label={key ? t(`projects.status.${key}`) : t("projects.unset")} /><strong>{entries.length}</strong>
      </div>)}
    </section>
    <section className="projects-message"><h2>{t("projects.iteration")}</h2>
      {iterations.size === 0 && <p>{t("projects.noMatchingItems")}</p>}
      {[...iterations].map(([key, count]) => <div key={key} className="projects-insight-row"><span>{key}</span><meter max={items.length} value={count} aria-label={key} /><strong>{count}</strong></div>)}
    </section>
  </div>;
}

function ProjectHistory({ orgID, number }: { orgID: string; number: number }) {
  const { t, i18n } = useTranslation("repositories");
  const [days, setDays] = useState<ProjectStatusDay[]>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    projectsAPI.statusHistory(orgID, number, controller.signal).then((items) => {
      if (!controller.signal.aborted) setDays(items);
    }, () => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [orgID, number, attempt]);
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeZone: "UTC" });
  const columns: DataTableColumn<ProjectStatusDay>[] = [
    { key: "date", title: t("projects.history.date"), render: (_, day) => <time dateTime={day.date}>{dateFormat.format(new Date(day.date))}</time> },
    ...projectStatuses.map((status) => ({ key: status, title: t(`projects.status.${status}`) })),
  ];
  return <section className="projects-message" aria-labelledby="project-status-history">
    <h2 id="project-status-history">{t("projects.history.title")}</h2>
    <p>{t("projects.history.hint")}</p>
    {failed ? <div role="alert">{t("projects.history.failed")} <Button onClick={() => {
      setFailed(false);
      setAttempt((value) => value + 1);
    }}>{t("issues.composer.retry")}</Button></div> : days ? <div className="projects-table-scroll">
      <DataTable columns={columns} data={[...days].reverse()} rowKey="date" showColumnVisibility={false} />
    </div> : <p role="status">{t("common:components.loading")}</p>}
  </section>;
}
