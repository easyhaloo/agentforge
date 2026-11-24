import { History } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { translateError } from "../../shared/api/errors";
import { changesetAPI, repositoryAPI, type OrganizationSummary } from "../../shared/api/identity";
import { issuesAPI } from "../../shared/api/issues";
import { projectGroups, projectLayouts, projectPriorities, projectSorts, projectStatuses, projectUpdateStatuses, projectsAPI, type NewProjectItem, type Project, type ProjectAutoAdd, type ProjectItem, type ProjectItemPlacement, type ProjectUpdateInput, type ProjectView, type ProjectWorkflowRun, type ProjectWorkflows } from "../../shared/api/projects";
import { organizationHandle, orgPath, projectPath } from "../../shared/routing";
import { Button, Checkbox, Input, NumberInput, Select, TextArea } from "../../shared/ui";
import { ProjectItemFieldEditor } from "./ProjectCustomFields";
import { parseProjectSourceLink, projectItemSource } from "./projectViews";

type FormContext = { organization: OrganizationSummary; project: Project; viewURL: string; complete: (updated?: Project, to?: string) => void };
const pageSize = 25;

function useWrite() {
  const { t } = useTranslation("repositories");
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function write(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try { await action(); }
    catch (cause) { setError(translateError(cause, t, "projects.saveFailed")); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return { busy, error, write };
}

function useRepositories(orgID: string) {
  const [names, setNames] = useState<string[]>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    repositoryAPI.list(orgID, controller.signal).then(({ items }) => {
      if (!controller.signal.aborted) setNames((items ?? []).map((repository) => repository.slug));
    }, () => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [orgID, attempt]);
  return { names, failed, retry: () => { setFailed(false); setAttempt((value) => value + 1); } };
}

function FormHeading({ title, project }: { title: string; project: Project }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <header className="projects-heading"><div><h1 ref={heading} tabIndex={-1}>{title}</h1><p>{project.name} #{project.number}</p></div></header>;
}

function FormActions({ busy, cancel, children }: { busy: boolean; cancel: string; children: ReactNode }) {
  const { t } = useTranslation("repositories");
  return <div className="projects-actions">{children}
    {!busy && <Link className="af-button af-button--secondary af-button--middle" to={cancel}>{t("projects.cancel")}</Link>}
  </div>;
}

export function ProjectFormPage(props: FormContext & {
  page: string; item?: ProjectItem; items?: ProjectItem[]; itemError: string; itemArchive: boolean; views: ProjectView[]; view: ProjectView;
  fieldsURL: string; workflowsURL: string; onItemVersionChange: (version: number) => void; admin: boolean; writable: boolean; initialRepository: string; initialFilter: string; placement: ProjectItemPlacement; retry: () => void;
}) {
  const { t } = useTranslation("repositories");
  if (props.page === "item") {
    if (props.itemError) return <div role="alert">{props.itemError} <Button onClick={props.retry}>{t("issues.composer.retry")}</Button></div>;
    if (!props.items) return <p role="status">{t("common:components.loading")}</p>;
    return props.item ? <ItemForm {...props} item={props.item} /> : <p role="alert">{t("projects.itemUnavailable")}</p>;
  }
  if (props.page === "workflows" && props.admin) return <WorkflowForm {...props} />;
  if (props.page === "settings" && props.admin) return <SettingsForm {...props} />;
  if (!props.writable) return <p role="alert">{t("errors:forbidden")}</p>;
  if (props.page === "update-new") return <UpdateForm {...props} />;
  if (props.page === "settings" || (props.page !== "add" && !props.admin)) return <p role="alert">{t("errors:forbidden")}</p>;
  return props.page === "add" ? <AddItems {...props} /> : <ViewForm {...props} />;
}

function UpdateForm({ organization, project, viewURL, complete }: FormContext) {
  const { t } = useTranslation("repositories");
  const { busy, error, write } = useWrite();
  const [status, setStatus] = useState<ProjectUpdateInput["status"]>("on_track");
  const [body, setBody] = useState("");
  const [start, setStart] = useState("");
  const [target, setTarget] = useState("");
  const updatesURL = `${viewURL}${viewURL.includes("?") ? "&" : "?"}page=updates`;
  return <>
    <FormHeading title={t("projects.newUpdate")} project={project} />
    <form className="projects-form" onSubmit={(event) => {
      event.preventDefault();
      if (!body.trim()) return;
      void write(async () => {
        await projectsAPI.publishUpdate(organization.id, project.number, { status, body, start_date: start, target_date: target });
        complete(undefined, updatesURL);
      });
    }}>
      {error && <p role="alert">{error}</p>}
      <fieldset className="projects-fields" disabled={busy}>
        <Select label={t("projects.updateStatusLabel")} value={status} options={projectUpdateStatuses.map((value) => ({ value, label: t(`projects.updateStatus.${value}`) }))}
          onChange={(event) => setStatus(event.target.value as ProjectUpdateInput["status"])} />
        <TextArea label={t("projects.updateBody")} required rows={8} maxLength={10000} value={body} onChange={(event) => setBody(event.target.value)} />
        <Input type="date" label={t("projects.startDate")} max={target || undefined} value={start} onChange={(event) => setStart(event.target.value)} />
        <Input type="date" label={t("projects.targetDate")} min={start || undefined} value={target} onChange={(event) => setTarget(event.target.value)} />
      </fieldset>
      <FormActions busy={busy} cancel={updatesURL}><Button type="submit" variant="primary" loading={busy} disabled={!body.trim()}>{t("projects.publishUpdate")}</Button></FormActions>
    </form>
  </>;
}

type Candidate = { id: string; label: string; input: NewProjectItem };

function AddItems({ organization, project, initialRepository, viewURL, complete, items, placement }: FormContext & { initialRepository: string; items?: ProjectItem[]; placement: ProjectItemPlacement }) {
  const { t } = useTranslation("repositories");
  const { busy, error, write } = useWrite();
  const repos = useRepositories(organization.id);
  const [mode, setMode] = useState<"issue" | "pull_request" | "draft">("issue");
  const [repository, setRepository] = useState(initialRepository);
  const selectedRepo = repos.names?.includes(repository) ? repository : repos.names?.[0] ?? "";
  const [title, setTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [sourceLink, setSourceLink] = useState("");
  const [archivedMatches, setArchivedMatches] = useState<ProjectItem[]>([]);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<{ candidates: Candidate[]; next: boolean }>();
  const [lookupError, setLookupError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<Record<string, Candidate>>({});
  const handle = organizationHandle(organization);
  const pastedSource = sourceLink.trim() ? parseProjectSourceLink(sourceLink.trim(), window.location.origin, handle) : undefined;

  useEffect(() => {
    if (mode === "draft" || !selectedRepo) return;
    const controller = new AbortController();
    setLookupError(false);
    setResult(undefined);
    const timer = window.setTimeout(async () => {
      try {
        const search = query.trim().replace(/^#(\d+)$/, "$1");
        const filters = { repository: selectedRepo, q: search, limit: pageSize, offset };
        if (mode === "issue") {
          const response = await issuesAPI.list(organization.id, filters, controller.signal);
          if (!controller.signal.aborted) setResult({ next: offset + pageSize < response.total, candidates: (response.items ?? []).map((item) => ({
            id: `${selectedRepo}#${item.number}`, label: `#${item.number} ${item.title}`, input: { kind: "issue", repository: selectedRepo, number: item.number },
          })) });
        } else {
          const response = await changesetAPI.list(organization.id, filters, controller.signal);
          if (!controller.signal.aborted) setResult({ next: offset + pageSize < response.total, candidates: (response.items ?? []).flatMap(({ changeset }) =>
            changeset.pull_request ? [{ id: changeset.id, label: changeset.title, input: { kind: "pull_request", repository: selectedRepo, source_id: changeset.id } }] : [],
          ) });
        }
      } catch { if (!controller.signal.aborted) setLookupError(true); }
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [organization.id, mode, selectedRepo, query, offset, attempt]);

  function importItems(event: FormEvent) {
    event.preventDefault();
    void write(async () => {
      if (mode === "draft") {
        if (!title.trim()) return;
        await projectsAPI.addItem(organization.id, project.number, { kind: "draft", title: title.trim(), draft_body: draftBody, ...placement });
      } else {
        const batch = Object.values(selected);
        const archivedItems: ProjectItem[] = [];
        if (pastedSource) {
          const added = await projectsAPI.addItem(organization.id, project.number, { ...pastedSource, ...placement });
          if (added.archived) archivedItems.push(added);
          setSourceLink("");
        }
        if (!batch.length && !pastedSource) return;
        for (const candidate of batch) {
          const added = await projectsAPI.addItem(organization.id, project.number, { ...candidate.input, ...placement });
          if (added.archived) archivedItems.push(added);
          setSelected((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== candidate.id)));
        }
        if (archivedItems.length) {
          setArchivedMatches(archivedItems);
          return;
        }
      }
      complete();
    });
  }

  return <><FormHeading title={t("projects.addItems")} project={project} />
    {placement.status && <p>{t("projects.addToColumn", { column: t(`projects.status.${placement.status}`) })}</p>}
    {placement.priority !== undefined && <p>{t("projects.addToColumn", { column: placement.priority.toUpperCase() || t("projects.unset") })}</p>}
    <form className="projects-form" onSubmit={importItems}>
      {error && <p className="projects-error" role="alert">{error}</p>}
      {archivedMatches.length > 0 && <div className="projects-message"><p role="status">{t("projects.archivedMatches")}</p>
        <ul>{[...new Map(archivedMatches.map((item) => [item.id, item])).values()].map((item) => <li key={item.id}>
          <Link to={`${viewURL}${viewURL.includes("?") ? "&" : "?"}${new URLSearchParams({ page: "item", item: item.id, archived: "true" })}`}>{item.title}</Link>
        </li>)}</ul>
      </div>}
      <Select label={t("projects.itemType")} value={mode} disabled={busy} options={(["issue", "pull_request", "draft"] as const).map((value) => ({ value, label: t(`projects.kind.${value}`) }))}
        onChange={(event) => { setMode(event.target.value as typeof mode); setOffset(0); setQuery(""); }} />
      {mode === "draft" ? <>
        <Input label={t("projects.itemTitle")} required maxLength={500} value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} />
        <TextArea label={t("projects.description")} rows={8} maxLength={65536} value={draftBody} disabled={busy} onChange={(event) => setDraftBody(event.target.value)} />
      </> : <>
        {repos.failed && <div role="alert">{t("projects.repositoryLoadFailed")} <Button onClick={repos.retry}>{t("issues.composer.retry")}</Button></div>}
        <Select label={t("projects.repository")} value={selectedRepo} disabled={busy || !repos.names?.length} options={(repos.names ?? []).map((value) => ({ value, label: value }))}
          onChange={(event) => { setRepository(event.target.value); setOffset(0); }} />
        <Input label={t("projects.sourceLink")} value={sourceLink} disabled={busy} onChange={(event) => setSourceLink(event.target.value)}
          error={sourceLink.trim() && !pastedSource ? t("projects.invalidSourceLink") : undefined} />
        <Input type="search" label={t("projects.searchItems")} value={query} disabled={busy || !selectedRepo} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} />
        {lookupError ? <div role="alert">{t("issues.projects.loadFailed")} <Button onClick={() => setAttempt(attempt + 1)}>{t("issues.composer.retry")}</Button></div> :
          selectedRepo && !result ? <p role="status">{t("common:components.loading")}</p> : result?.candidates.length ?
            <ul className="projects-directory projects-candidates">{result.candidates.map((candidate) => {
              const existing = items?.some((item) => candidate.input.kind === "issue" ? item.kind === "issue" && item.repository === candidate.input.repository && item.number === candidate.input.number :
                candidate.input.kind === "pull_request" && item.kind === "pull_request" && item.source_id === candidate.input.source_id);
              return <li key={candidate.id}><Checkbox label={`${candidate.label}${existing ? ` · ${t("projects.alreadyAdded")}` : ""}`} checked={existing || Boolean(selected[candidate.id])} disabled={busy || existing}
                onChange={(event) => setSelected(event.target.checked ? { ...selected, [candidate.id]: candidate } : Object.fromEntries(Object.entries(selected).filter(([id]) => id !== candidate.id)))} /></li>;
            })}</ul> : <p>{t("projects.noCandidates")}</p>}
        {(offset > 0 || result?.next) && <div className="projects-toolbar">
          <Button disabled={busy || offset === 0} onClick={() => setOffset(offset - pageSize)}>{t("projects.previous")}</Button>
          <Button disabled={busy || !result?.next} onClick={() => setOffset(offset + pageSize)}>{t("projects.next")}</Button>
        </div>}
        <p role="status">{t("projects.selectedItems", { count: Object.keys(selected).length })}</p>
      </>}
      <FormActions busy={busy} cancel={viewURL}><Button type="submit" variant="primary" loading={busy} disabled={mode === "draft" ? !title.trim() : sourceLink.trim() ? !pastedSource : !Object.keys(selected).length}>
        {t(mode === "draft" ? "projects.createDraft" : "projects.addSelected")}
      </Button></FormActions>
      {mode !== "draft" && <Link to={`${projectPath(handle, project.number)}?page=archive`}>{t("projects.archive")}</Link>}
    </form></>;
}

function ItemForm({ organization, project, item, viewURL, complete, writable, itemArchive, admin, retry, onItemVersionChange }: FormContext & { item: ProjectItem; writable: boolean; itemArchive: boolean; admin: boolean; retry: () => void; onItemVersionChange: (version: number) => void }) {
  const { t } = useTranslation("repositories");
  const { busy, error, write } = useWrite();
  const [title, setTitle] = useState(item.title);
  const [draftBody, setDraftBody] = useState(item.draft_body ?? "");
  const [status, setStatus] = useState(item.status);
  const [priority, setPriority] = useState(item.priority ?? "");
  const [start, setStart] = useState(item.start_date ?? "");
  const [target, setTarget] = useState(item.target_date ?? "");
  const [iteration, setIteration] = useState(item.iteration ?? "");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [convert, setConvert] = useState(false);
  const [destination, setDestination] = useState(project.default_repository ?? project.repository ?? "");
  const repos = useRepositories(organization.id);
  const link = projectItemSource(organizationHandle(organization), item);
  const returnURL = itemArchive ? `${viewURL}${viewURL.includes("?") ? "&" : "?"}page=archive` : viewURL;
  const validDates = !start || !target || start <= target;
  const hasUnsavedChanges = title.trim() !== item.title || draftBody !== (item.draft_body ?? "") || status !== item.status ||
    priority !== (item.priority ?? "") || start !== (item.start_date ?? "") || target !== (item.target_date ?? "") ||
    iteration.trim() !== (item.iteration ?? "");
  function patch(change: Omit<Parameters<typeof projectsAPI.updateItem>[3], "version">) {
    return write(async () => {
      await projectsAPI.updateItem(organization.id, project.number, item.id, { version: item.version, ...change });
      complete(undefined, returnURL);
    });
  }
  return <><FormHeading title={item.title} project={project} />
    <form className="projects-form" onSubmit={(event) => { event.preventDefault(); if (writable && validDates) void patch({
      ...(item.kind === "draft" && { title: title.trim(), draft_body: draftBody }), status, priority, start_date: start, target_date: target, iteration: iteration.trim(),
    }); }}>
      {error && <p className="projects-error" role="alert">{error}</p>}
      {link && <Link to={link}>{t("projects.openSource", { repository: item.repository })}</Link>}
      <fieldset className="projects-fields" disabled={!writable || busy || item.archived}>
        {item.kind === "draft" && <>
          <Input label={t("projects.itemTitle")} required maxLength={500} value={title} onChange={(event) => setTitle(event.target.value)} />
          <TextArea label={t("projects.description")} rows={8} maxLength={65536} value={draftBody} onChange={(event) => setDraftBody(event.target.value)} />
        </>}
        <Select label={t("projects.statusLabel")} value={status} onChange={(event) => setStatus(event.target.value as typeof status)}
          options={projectStatuses.map((value) => ({ value, label: value ? t(`projects.status.${value}`) : t("projects.unset") }))} />
        <Select label={t("projects.priority")} value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}
          options={["", ...projectPriorities].map((value) => ({ value, label: value.toUpperCase() || t("projects.unset") }))} />
        <Input type="date" label={t("projects.startDate")} value={start} onChange={(event) => setStart(event.target.value)} />
        <Input type="date" label={t("projects.targetDate")} value={target} onChange={(event) => setTarget(event.target.value)} error={validDates ? undefined : t("projects.dateOrder")} />
        <Input label={t("projects.iteration")} maxLength={100} value={iteration} onChange={(event) => setIteration(event.target.value)} />
      </fieldset>
      <FormActions busy={busy} cancel={returnURL}>{writable && !item.archived && <Button type="submit" variant="primary" loading={busy} disabled={!title.trim() || !validDates}>{t("projects.saveChanges")}</Button>}</FormActions>
    </form>
    <ProjectItemFieldEditor orgID={organization.id} projectNumber={project.number} itemID={item.id} itemVersion={item.version}
      canEdit={writable && !item.archived && !busy} onItemVersionChange={onItemVersionChange} onRefresh={retry} />
    {writable && <div className="projects-toolbar">
      <Button disabled={busy} onClick={() => void patch({ archived: !item.archived })}>{t(item.archived ? "projects.restoreItem" : "projects.archiveItem")}</Button>
      {admin && item.kind === "draft" && !item.archived && <>
        <Button disabled={busy || hasUnsavedChanges} onClick={() => setConvert(!convert)}>{t("projects.convertItem")}</Button>
        {hasUnsavedChanges && <span>{t("projects.saveBeforeConvert")}</span>}
      </>}
      <Button disabled={busy} onClick={() => setConfirmRemove(!confirmRemove)}>{t("projects.removeItem")}</Button>
    </div>}
    {convert && writable && <div className="projects-message projects-form">
      {repos.failed && <div role="alert">{t("projects.repositoryLoadFailed")} <Button onClick={repos.retry}>{t("issues.composer.retry")}</Button></div>}
      <Select label={t("projects.repository")} value={destination} disabled={busy || !repos.names?.length} options={[
        { value: "", label: t("projects.chooseRepository") }, ...(repos.names ?? []).map((value) => ({ value, label: value })),
      ]} onChange={(event) => setDestination(event.target.value)} />
      <Button variant="primary" loading={busy} disabled={hasUnsavedChanges || !repos.names?.includes(destination)} onClick={() => void write(async () => {
        await projectsAPI.convertItem(organization.id, project.number, item.id, destination, item.version);
        complete();
      })}>{t("projects.convertConfirm")}</Button>
    </div>}
    {confirmRemove && writable && <div className="projects-message"><p>{t("projects.removeItemHint")}</p>
      <Button variant="danger" loading={busy} onClick={() => void write(async () => {
        await projectsAPI.removeItem(organization.id, project.number, item.id, item.version);
        complete(undefined, returnURL);
      })}>{t("projects.removeConfirm")}</Button>
    </div>}
  </>;
}

const sourceWorkflows = ["issue_closed", "pull_request_closed", "pull_request_merged"] as const;

function WorkflowForm({ organization, project, viewURL, complete }: FormContext) {
  const { t } = useTranslation("repositories");
  const { busy, error, write } = useWrite();
  const [workflows, setWorkflows] = useState<ProjectWorkflows>(project.workflows);
  const [archiveDays, setArchiveDays] = useState(project.workflows.auto_archive_days ? String(project.workflows.auto_archive_days) : "");
  const [invalidArchiveDays, setInvalidArchiveDays] = useState(false);
  const archiveLabel = t("projects.workflows.autoArchiveDays");
  const statuses = projectStatuses.map((value) => ({ value, label: t(`projects.status.${value}`) }));
  const optionalStatuses = [{ value: "", label: t("projects.workflows.disabled") }, ...statuses];
  return <><FormHeading title={t("projects.workflows.title")} project={project} />
    <p>{t(project.closed ? "projects.closedNotice" : "projects.workflows.hint")}</p>
    <form className="projects-form" onSubmit={(event) => {
      event.preventDefault();
      if (project.closed) return;
      void write(async () => complete(await projectsAPI.update(organization.id, project.number, {
        version: project.version,
        workflows: { ...workflows, auto_archive_days: Number(archiveDays) },
      })));
    }}>
      {error && <p role="alert">{error}</p>}
      <fieldset className="projects-fields" disabled={busy || project.closed}>
        <Select label={t("projects.workflows.item_added")} value={workflows.item_added} options={statuses}
          onChange={(event) => setWorkflows({ ...workflows, item_added: event.target.value as ProjectWorkflows["item_added"] })} />
        {sourceWorkflows.map((key) => <Select key={key} label={t(`projects.workflows.${key}`)} value={workflows[key]} options={optionalStatuses}
          onChange={(event) => setWorkflows({ ...workflows, [key]: event.target.value })} />)}
        <NumberInput
          label={archiveLabel}
          aria-label={archiveLabel}
          placeholder={t("projects.workflows.disabled")}
          hint={t("projects.workflows.autoArchiveHint")}
          error={invalidArchiveDays ? t("projects.workflows.autoArchiveInvalid") : undefined}
          min={0} max={365} step={1} value={archiveDays}
          onInvalid={() => setInvalidArchiveDays(true)}
          onChange={(event) => {
            setArchiveDays(event.currentTarget.value);
            setInvalidArchiveDays(!event.currentTarget.validity.valid);
          }}
        />
        <AutoAddFields orgID={organization.id} repositoryScope={project.repository} value={workflows.auto_add}
          onChange={(auto_add) => setWorkflows({ ...workflows, auto_add })} />
      </fieldset>
      <FormActions busy={busy} cancel={viewURL}>{!project.closed && <Button type="submit" variant="primary" loading={busy}>{t("projects.saveChanges")}</Button>}</FormActions>
    </form>
    <WorkflowHistory key={`${organization.id}/${project.number}`} orgID={organization.id} number={project.number} />
  </>;
}

function AutoAddFields({ orgID, repositoryScope, value, onChange }: {
  orgID: string; repositoryScope?: string; value?: ProjectAutoAdd; onChange: (value?: ProjectAutoAdd) => void;
}) {
  const { t } = useTranslation("repositories");
  const repos = useRepositories(orgID);
  const repository = value?.repository ?? "";
  const names = repos.names?.filter((name) => !repositoryScope || name === repositoryScope);
  const available = names?.includes(repository) ?? false;
  const choices = (names ?? []).map((name) => ({ value: name, label: name }));
  if (repository && !available) choices.unshift({ value: repository, label: names
    ? t("issues.composer.unavailableOption", { id: repository }) : repository });
  let hint = "disabledHint";
  if (value?.kind === "issue") hint = value.label_id ? "labeledIssueHint" : "issueHint";
  if (value?.kind === "pull_request") hint = "pullRequestHint";

  return <fieldset className="projects-fields">
    <legend>{t("projects.workflows.auto_add")}</legend>
    <Select label={t("projects.workflows.autoAdd.repository")} value={repository} hint={t(`projects.workflows.autoAdd.${hint}`)}
      options={[{ value: "", label: t("projects.workflows.disabled") }, ...choices]}
      onChange={(event) => {
        const next = event.target.value;
        if (next !== repository) onChange(next ? { repository: next, kind: value?.kind ?? "issue" } : undefined);
      }} />
    {repos.failed ? <div className="projects-toolbar">
      <p role="alert">{t("projects.workflows.autoAdd.repositoriesFailed")}</p>
      <Button type="button" onClick={repos.retry}>{t("issues.composer.retry")}</Button>
    </div> : !repos.names && <p role="status">{t("common:components.loading")}</p>}
    {value && <Select label={t("projects.workflows.autoAdd.kind")} value={value.kind}
      options={(["issue", "pull_request"] as const).map((kind) => ({ value: kind, label: t(`projects.kind.${kind}`) }))}
      onChange={(event) => {
        const kind = event.target.value as ProjectAutoAdd["kind"];
        if (kind !== value.kind) onChange({ repository, kind });
      }} />}
    {value?.kind === "issue" && <AutoAddLabel key={`${orgID}/${repository}`} orgID={orgID} repository={repository}
      available={available} value={value.label_id ?? ""}
      onChange={(labelID) => onChange({ ...value, label_id: labelID || undefined })} />}
  </fieldset>;
}

function AutoAddLabel({ orgID, repository, available, value, onChange }: {
  orgID: string; repository: string; available: boolean; value: string; onChange: (value: string) => void;
}) {
  const { t } = useTranslation("repositories");
  const [labels, setLabels] = useState<Awaited<ReturnType<typeof issuesAPI.labels>>>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!available) return;
    const [owner, repo] = repository.split("/");
    let current = true;
    issuesAPI.labels(orgID, owner, repo).then((items) => {
      if (current) setLabels(items);
    }, () => {
      if (current) setFailed(true);
    });
    return () => { current = false; };
  }, [orgID, repository, available, attempt]);
  const choices = (labels ?? []).map(({ id, name }) => ({ value: id, label: name }));
  if (value && !choices.some((choice) => choice.value === value)) choices.unshift({ value, label: labels
    ? t("issues.composer.unavailableOption", { id: value }) : value });

  return <>
    <Select label={t("projects.workflows.autoAdd.label")} value={value}
      options={[{ value: "", label: t("projects.workflows.autoAdd.anyLabel") }, ...choices]}
      onChange={(event) => onChange(event.target.value)} />
    {failed ? <div className="projects-toolbar">
      <p role="alert">{t("projects.workflows.autoAdd.labelsFailed")}</p>
      <Button type="button" onClick={() => { setFailed(false); setAttempt((current) => current + 1); }}>{t("issues.composer.retry")}</Button>
    </div> : available && !labels && <p role="status">{t("common:components.loading")}</p>}
  </>;
}

function WorkflowHistory({ orgID, number }: { orgID: string; number: number }) {
  const { t, i18n } = useTranslation("repositories");
  const headingID = useId();
  const [runs, setRuns] = useState<ProjectWorkflowRun[]>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    projectsAPI.workflowRuns(orgID, number, controller.signal).then((items) => {
      if (!controller.signal.aborted) setRuns(items);
    }, () => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [orgID, number, attempt]);
  const formatTime = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });

  return <section className="projects-form" aria-labelledby={headingID}>
    <h2 id={headingID}>{t("projects.workflows.history.title")}</h2>
    {failed ? <div className="projects-message">
      <p role="alert">{t("projects.workflows.history.failed")}</p>
      <Button onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>{t("issues.composer.retry")}</Button>
    </div> : !runs ? <p role="status">{t("common:components.loading")}</p> : !runs.length ?
      <p className="projects-message">{t("projects.workflows.history.empty")}</p> :
      <ul className="projects-directory">
        {runs.map(({ id, rule, item_count, occurred_at }) => <li key={id}>
          <span className="projects-glyph"><History size={16} aria-hidden /></span>
          <strong>{t(`projects.workflows.${rule}`)}</strong>
          <span>{t("projects.workflows.history.itemCount", { count: item_count })}</span>
          <span><time dateTime={occurred_at}>{formatTime.format(new Date(occurred_at))}</time></span>
        </li>)}
      </ul>}
  </section>;
}

function SettingsForm({ organization, project, viewURL, complete, fieldsURL, workflowsURL }: FormContext & { fieldsURL: string; workflowsURL: string }) {
  const { t } = useTranslation("repositories");
  const { busy, error, write } = useWrite();
  const repos = useRepositories(organization.id);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [readme, setReadme] = useState(project.readme ?? "");
  const [defaultRepo, setDefaultRepo] = useState(project.default_repository ?? "");
  const [linked, setLinked] = useState(project.repositories ?? []);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const orgID = organization.id;

  return <><FormHeading title={t("projects.settings")} project={project} />
    <div className="projects-toolbar"><Link to={fieldsURL}>{t("projectFields:title")}</Link><Link to={workflowsURL}>{t("projects.workflows.title")}</Link></div>
    {error && <p className="projects-error" role="alert">{error}</p>}
    <form className="projects-form" onSubmit={(event) => {
      event.preventDefault();
      if (!name.trim() || project.closed) return;
      void write(async () => complete(await projectsAPI.update(orgID, project.number, {
        version: project.version, name: name.trim(), description: description.trim(), readme,
        ...(defaultRepo !== (project.default_repository ?? "") && { default_repository: defaultRepo }),
        ...(linked !== project.repositories && repos.names && { repositories: linked }),
      })));
    }}>
      <fieldset className="projects-fields" disabled={busy || project.closed}>
        <Input label={t("issues.projects.name")} required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
        <TextArea label={t("projects.description")} maxLength={500} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
        <TextArea label={t("projects.readme")} maxLength={65536} rows={8} value={readme} onChange={(event) => setReadme(event.target.value)} />
        {repos.failed && <div role="alert">{t("projects.repositoryLoadFailed")} <Button onClick={repos.retry}>{t("issues.composer.retry")}</Button></div>}
        <Select label={t("projects.defaultRepository")} value={defaultRepo} disabled={!repos.names} options={[
          { value: "", label: t("projects.noDefault") }, ...(repos.names ?? []).map((value) => ({ value, label: value })),
        ]} onChange={(event) => setDefaultRepo(event.target.value)} />
        {Boolean(repos.names?.length) && <fieldset className="projects-fields"><legend>{t("projects.linkedRepositories")}</legend>
          {repos.names?.map((slug) => <Checkbox key={slug} label={slug} checked={linked.includes(slug)} disabled={project.repository === slug}
            onChange={(event) => setLinked(event.target.checked ? [...linked, slug] : linked.filter((value) => value !== slug))} />)}
        </fieldset>}
      </fieldset>
      <FormActions busy={busy} cancel={viewURL}>{!project.closed && <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>{t("projects.saveChanges")}</Button>}</FormActions>
    </form>
    <section className="projects-message projects-form" aria-label={t("projects.lifecycle")}>
      <h2>{t("projects.lifecycle")}</h2>
      <p>{t(project.closed ? "projects.closedNotice" : "projects.closeHint")}</p>
      <div className="projects-toolbar">
        <Button loading={busy} onClick={() => void write(async () => complete(await projectsAPI.update(orgID, project.number, {
          version: project.version, closed: !project.closed,
        })))}>{t(project.closed ? "projects.reopenProject" : "projects.closeProject")}</Button>
        <Button variant="danger" disabled={busy} onClick={() => setDeleting(!deleting)}>{t("projects.deleteProject")}</Button>
      </div>
      {deleting && <form className="projects-form" onSubmit={(event) => {
        event.preventDefault();
        if (confirmation !== project.name) return;
        void write(async () => {
          await projectsAPI.remove(orgID, project.number, project.version);
          complete(undefined, orgPath(organizationHandle(organization), "projects"));
        });
      }}>
        <Input label={t("projects.deleteHint", { name: project.name })} value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} />
        <Button type="submit" variant="danger" loading={busy} disabled={confirmation !== project.name}>{t("projects.deleteConfirm")}</Button>
      </form>}
    </section>
  </>;
}

function ViewForm({ organization, project, views, view, page, viewURL, initialFilter, complete }: FormContext & {
  views: ProjectView[]; view: ProjectView; page: string; initialFilter: string;
}) {
  const { t } = useTranslation("repositories");
  const { busy, error, write } = useWrite();
  const editing = page === "view-edit";
  const copied = page === "view-copy";
  const label = view.name || t(`projects.${view.layout}`);
  const [name, setName] = useState(editing ? label : copied ? t("projects.copyName", { name: label }) : "");
  const [layout, setLayout] = useState(editing || copied ? view.layout : "table");
  const [filter, setFilter] = useState(editing || copied ? initialFilter : "");
  const [sort, setSort] = useState(editing || copied ? view.sort : "manual");
  const [group, setGroup] = useState(editing || copied ? view.group : "none");
  const [position, setPosition] = useState(editing ? views.indexOf(view) : views.length);
  const [deleting, setDeleting] = useState(false);
  const base = projectPath(organizationHandle(organization), project.number);
  const full = views.length >= 30;

  function save(nextViews: ProjectView[], selected: string) {
    return write(async () => {
      const updated = await projectsAPI.update(organization.id, project.number, { version: project.version, views: nextViews });
      complete(updated, selected ? `${base}?${new URLSearchParams({ view: selected })}` : base);
    });
  }

  return <><FormHeading title={t(editing ? "projects.viewOptions" : copied ? "projects.copyView" : "projects.newView")} project={project} />
    <form className="projects-form" onSubmit={(event) => {
      event.preventDefault();
      if (!name.trim() || (!editing && full)) return;
      const next = { id: editing ? view.id : crypto.randomUUID(), name: name.trim(), layout, filter: filter.trim(), sort, group: layout === "board" && group === "none" ? "status" : group } satisfies ProjectView;
      const nextViews = views.filter(({ id }) => !editing || id !== view.id);
      nextViews.splice(position, 0, next);
      void save(nextViews, next.id);
    }}>
      {error && <p className="projects-error" role="alert">{error}</p>}
      {!editing && full && <p role="status">{t("projects.viewLimit")}</p>}
      <fieldset className="projects-fields" disabled={busy}>
        <Input label={t("projects.viewName")} required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
        <Select label={t("projects.layout")} value={layout} options={projectLayouts.map((value) => ({ value, label: t(`projects.${value}`) }))}
          onChange={(event) => { const value = event.target.value as typeof layout; setLayout(value); if (value === "board" && group === "none") setGroup("status"); }} />
        <Input label={t("projects.filter")} placeholder={t("projects.filterHint")} maxLength={200} value={filter} onChange={(event) => setFilter(event.target.value)} />
        <Select label={t("projects.itemSort")} value={sort} options={projectSorts.map((value) => ({ value, label: t(`projects.sortBy.${value}`) }))}
          onChange={(event) => setSort(event.target.value as typeof sort)} />
        <Select label={t("projects.groupLabel")} value={group} options={projectGroups.filter((value) => layout !== "board" || value !== "none").map((value) => ({ value, label: t(`projects.group.${value}`) }))}
          onChange={(event) => setGroup(event.target.value as typeof group)} />
        <Select label={t("projects.viewPosition")} value={String(position)} options={Array.from({ length: views.length + (editing ? 0 : 1) }, (_, index) => ({
          value: String(index), label: index === 0 ? t("projects.defaultView") : String(index + 1),
        }))} onChange={(event) => setPosition(Number(event.target.value))} />
      </fieldset>
      <FormActions busy={busy} cancel={viewURL}><Button type="submit" variant="primary" loading={busy} disabled={!name.trim() || (!editing && full)}>{t(editing ? "projects.saveChanges" : "projects.createView")}</Button></FormActions>
    </form>
    {editing && <div className="projects-toolbar">
      {!busy && !full && <Link to={`${base}?${new URLSearchParams({ page: "view-copy", view: view.id })}`}>{t("projects.copyView")}</Link>}
      {views.length > 1 && <Button variant="danger" disabled={busy} onClick={() => setDeleting(!deleting)}>{t("projects.deleteView")}</Button>}
    </div>}
    {deleting && <div className="projects-message"><p>{t("projects.deleteViewHint")}</p>
      <Button variant="danger" loading={busy} onClick={() => void save(views.filter(({ id }) => id !== view.id), "")}>{t("projects.deleteConfirm")}</Button>
    </div>}
  </>;
}
