import { useEffect, useState } from "react";
import { Activity, Clock3, GitBranch, GitCommitHorizontal, Play, Plus, Settings2, Workflow } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { repositoryAPI, type OrganizationSummary, type RepositoryAction } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { pipelines } from "../../shared/api/pipelines";
import { useDateFormatting } from "../../shared/i18n/format";
import { organizationHandle, pipelineEditPath, pipelineRunPath, repositoryActionFilters, repositoryActionsContext } from "../../shared/routing";
import { Button, ConfirmDialog, Input, Select } from "../../shared/ui";
import { PipelineStatusIcon } from "../pipelines/PipelineStatus";
import { CreatePipelineDialog } from "../pipelines/PipelinesPage";
import { RunDialog } from "../pipelines/RunPanel";
import { WorkflowTriggers } from "./WorkflowTriggers";

const statuses = ["queued", "running", "succeeded", "failed", "cancelled", "timed_out"] as const;
const events = ["manual", "webhook", "changeset_revision", "schedule", "merge_queue", "integration", "rerun"] as const;

export function RepositoryActions({ organization, repository }: { organization: OrganizationSummary; repository: string }) {
  const { t } = useTranslation("repositories");
  const { formatDateTime, formatRelativeTime } = useDateFormatting();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const [retry, setRetry] = useState(0);
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(false);
  const [triggerSettings, setTriggerSettings] = useState(false);
  const [togglingId, setTogglingId] = useState<string>();
  const [workflows, setWorkflows] = useState<Awaited<ReturnType<typeof repositoryAPI.workflows>>>();
  const [result, setResult] = useState<Awaited<ReturnType<typeof repositoryAPI.actions>>>();
  const [workflowError, setWorkflowError] = useState("");
  const [runError, setRunError] = useState("");
  const { id: org, role } = organization;
  const handle = organizationHandle(organization);
  const selected = search.get("workflow") ?? "";
  const current = workflows?.items?.find(item => item.id === selected);
  const canWrite = role !== "viewer";
  const canManage = role === "owner" || role === "admin";
  const canLaunch = current && current.version > 0 && current.status !== "archived" && current.repository === repository;
  const toggleLabel = current?.disabled ? t("actions.enableWorkflow") : t("actions.disableWorkflow");
  const query = new URLSearchParams();
  for (const key of repositoryActionFilters) {
    const value = search.get(key);
    if (value) query.set(key, value);
  }
  const queryString = query.toString();
  const offset = Number(query.get("offset")) || 0;
  const hasFilters = ["q", "status", "event", "actor", "branch"].some(key => query.has(key));

  useEffect(() => {
    const controller = new AbortController();
    setWorkflowError("");
    void repositoryAPI.workflows(org, repository, controller.signal).then(data => {
      if (!controller.signal.aborted) setWorkflows(data);
    }, cause => {
      if (!controller.signal.aborted) setWorkflowError(translateError(cause, t, "repositories:actions.workflowsFailed"));
    });
    return () => controller.abort();
  }, [org, repository, retry, t]);

  useEffect(() => {
    const controller = new AbortController();
    setResult(undefined);
    setRunError("");
    void repositoryAPI.actions(org, repository, queryString, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult(data);
    }, cause => {
      if (!controller.signal.aborted) setRunError(translateError(cause, t, "repositories:sections.actionsFailed"));
    });
    return () => controller.abort();
  }, [org, repository, queryString, retry, t]);

  function withQuery(key: string, value: string) {
    const next = new URLSearchParams(query);
    next.delete("offset");
    if (value) next.set(key, value); else next.delete(key);
    return next.size ? `?${next}` : "?";
  }
  const context = repositoryActionsContext(repository, query);
  const retryButton = <Button onClick={() => setRetry(n => n + 1)}>{t("common:actions.refresh")}</Button>;

  function renderRun(run: RepositoryAction) {
    const status = t(`pipelines:${run.status}`);
    const seconds = Math.round((Date.parse(run.completed_at ?? "") - Date.parse(run.created_at)) / 1000);
    return <li key={run.id} className="repo-actions-run">
      <span className="repo-actions-state" title={status} aria-label={status} role="img"><PipelineStatusIcon state={run.status} /></span>
      <div className="repo-actions-run-main">
        <Link className="repo-link" to={pipelineRunPath(handle, run.id) + context}>{run.pipeline}</Link>
        <div className="repo-actions-meta">
          <span>{t("actions.version", { version: run.version })}</span>
          <span>{t(`actions.events.${run.event}`)}</span>
          {run.actor && <span>{t("actions.by", { actor: run.actor })}</span>}
          {run.sha && <code title={run.sha}><GitCommitHorizontal size={13} aria-hidden="true" />{run.sha.slice(0, 7)}</code>}
        </div>
      </div>
      {run.branch && <span className="repo-actions-branch"><GitBranch size={13} aria-hidden="true" />{run.branch}</span>}
      <div className="repo-actions-timing">
        <time dateTime={run.created_at} title={formatDateTime(run.created_at)}>{formatRelativeTime(run.created_at)}</time>
        {seconds >= 0 && <span><Clock3 size={13} aria-hidden="true" />{seconds >= 60 ? t("actions.duration", { minutes: Math.floor(seconds / 60), seconds: seconds % 60 }) : t("actions.seconds", { seconds })}</span>}
      </div>
    </li>;
  }

  return <div className="repo-actions-layout">
    <aside className="repo-actions-rail">
      <header><h2>{t("sections.actions")}</h2>
        {canWrite && <Button size="small" onClick={() => setCreating(true)}><Plus size={15} aria-hidden="true" />{t("actions.newWorkflow")}</Button>}
      </header>
      <nav aria-label={t("actions.workflows")}>
        <Link to={withQuery("workflow", "")} aria-current={!selected ? "page" : undefined}><Activity size={16} aria-hidden="true" />{t("actions.allWorkflows")}</Link>
        {workflows?.items?.map(workflow => <Link key={workflow.id} to={withQuery("workflow", workflow.id)} aria-current={selected === workflow.id ? "page" : undefined}>
          <Workflow size={16} aria-hidden="true" /><span>{workflow.name}</span>
          {workflow.disabled && workflow.status !== "archived" ? <small>{t("pipelines:disabled")}</small> :
            workflow.status !== "published" && <small>{t(`pipelines:${workflow.status}`)}</small>}
        </Link>)}
      </nav>
      {workflowError && <p className="org-error" role="alert">{workflowError} {retryButton}</p>}
    </aside>
    <section className="repo-actions-body" aria-labelledby="repo-actions-title">
      <header className="repo-actions-heading">
        <div><h2 id="repo-actions-title">{current?.name ?? t(selected ? "actions.workflowRuns" : "actions.allWorkflows")}</h2>
          {current && <p>{t("actions.workflowSummary", { status: t(`pipelines:${current.disabled && current.status !== "archived" ? "disabled" : current.status}`), version: current.version })}</p>}</div>
        {current && <div className="repo-actions-controls">
          <Link className="repo-link" to={pipelineEditPath(handle, current.id) + context}><Settings2 size={15} aria-hidden="true" />{t("actions.workflowSettings")}</Link>
          {current.repository === repository && <Button onClick={() => setTriggerSettings(true)}>{t("actions.triggers.title")}</Button>}
          {canManage && canLaunch && <Button onClick={() => setTogglingId(current.id)}>{toggleLabel}</Button>}
          {canWrite && canLaunch && !current.disabled &&
            <Button variant="primary" onClick={() => setRunning(true)}><Play size={15} aria-hidden="true" />{t("actions.runWorkflow")}</Button>}
        </div>}
      </header>
      <form className="repo-actions-filter" key={JSON.stringify([query.get("q"), query.get("branch"), query.get("actor")])} onSubmit={event => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const next = new URLSearchParams(query);
        next.delete("offset");
        for (const key of ["q", "branch", "actor"]) {
          const value = String(fields.get(key) ?? "").trim();
          if (value) next.set(key, value); else next.delete(key);
        }
        setSearch(next);
      }}>
        <div className="repo-actions-search"><Input type="search" name="q" aria-label={t("actions.searchRuns")} placeholder={t("actions.searchRuns")} maxLength={170} defaultValue={query.get("q") ?? ""} />
          <Button type="submit">{t("common:actions.search")}</Button></div>
        <Select label={t("actions.status")} value={query.get("status") ?? ""} onChange={event => void navigate(withQuery("status", event.target.value))}
          options={[{ value: "", label: t("actions.anyStatus") }, ...statuses.map(status => ({ value: status, label: t(`pipelines:${status}`) }))]} />
        <Select label={t("actions.event")} value={query.get("event") ?? ""} onChange={event => void navigate(withQuery("event", event.target.value))}
          options={[{ value: "", label: t("actions.anyEvent") }, ...events.map(event => ({ value: event, label: t(`actions.events.${event}`) }))]} />
        <details className="repo-actions-advanced" open={query.has("branch") || query.has("actor") || undefined}>
          <summary>{t("actions.moreFilters")}</summary>
          <div><Input name="branch" label={t("actions.branch")} maxLength={85} defaultValue={query.get("branch") ?? ""} />
            <Input name="actor" label={t("actions.actor")} maxLength={85} defaultValue={query.get("actor") ?? ""} />
            <Button type="submit">{t("actions.applyFilters")}</Button></div>
        </details>
      </form>
      <div className="repo-panel repo-actions-results">
        <header><strong>{t("actions.runs")}</strong>{hasFilters && <Link className="repo-link" to={selected ? `?${new URLSearchParams({ workflow: selected })}` : "?"}>{t("actions.clearFilters")}</Link>}</header>
        {runError ? <p className="org-error repo-actions-message" role="alert">{runError} {retryButton}</p> : !result ? <p className="repo-actions-message" role="status">{t("common:components.loading")}</p> : result.items?.length ?
          <ul className="repo-actions-list">{result.items.map(renderRun)}</ul> : <div className="repo-actions-empty">
            <Workflow size={28} aria-hidden="true" />
            <h3>{t(hasFilters ? "actions.noMatches" : "sections.noActions")}</h3>
            {!hasFilters && <p>{t(current?.version === 0 ? "actions.draftHint" : "actions.emptyHint")}</p>}
            {canWrite && workflows?.items?.length === 0 && !hasFilters && !selected && <Button variant="primary" onClick={() => setCreating(true)}>{t("actions.newWorkflow")}</Button>}
          </div>}
        {result && (offset > 0 || result.has_more) && <div className="repo-section-pagination">
          <Button disabled={!offset} onClick={() => setSearch(new URLSearchParams(withQuery("offset", offset > 20 ? String(offset - 20) : "")))}>{t("common:actions.previous")}</Button>
          <Button disabled={!result.has_more} onClick={() => setSearch(new URLSearchParams(withQuery("offset", String(offset + 20))))}>{t("common:actions.next")}</Button>
        </div>}
      </div>
    </section>
    {creating && <CreatePipelineDialog organization={organization} repository={repository} onClose={() => setCreating(false)} />}
    {triggerSettings && current && <WorkflowTriggers key={current.id} org={org} workflow={current} canManage={canManage} onClose={() => setTriggerSettings(false)} />}
    {current && canManage && canLaunch && current.id === togglingId && <ConfirmDialog open title={toggleLabel} confirmText={toggleLabel}
      description={t(current.disabled ? "actions.enableWorkflowHint" : "actions.disableWorkflowHint")}
      onCancel={() => setTogglingId(undefined)} onConfirm={async () => {
        const updated = await pipelines.transition(org, current, current.disabled ? "enable" : "disable");
        setWorkflows(previous => previous && { items: previous.items?.map(item => item.id === updated.id ? updated : item) });
        setTogglingId(undefined);
      }} />}
    {running && canLaunch && !current.disabled && <RunDialog org={org} pipeline={current} onCancel={() => setRunning(false)} onSubmit={async (version, inputs) => {
      const run = await pipelines.start(org, current.id, version.number, inputs);
      void navigate(pipelineRunPath(handle, run.id) + context);
    }} />}
  </div>;
}
