import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, LayoutDashboard } from "lucide-react";
import { translateError } from "../../shared/api/errors";
import type { OrganizationSummary } from "../../shared/api/identity";
import { useDateFormatting } from "../../shared/i18n/format";
import { pipelines, type Definition, type Run } from "../../shared/api/pipelines";
import { organizationHandle, orgPath, pipelineEditPath, pipelineRunPath, repositoryActionsBackPath } from "../../shared/routing";
import { Button } from "../../shared/ui";
import { RunActions } from "./RunActions";
import { RunArtifacts, RunJobLogs } from "./RunOutput";
import { PipelineStatusIcon, PipelineStatusLabel } from "./PipelineStatus";
import { stepGroupState, WorkflowCanvas } from "./WorkflowCanvas";

export function PipelineRunPage({ organization, actorId, runId }: { organization: OrganizationSummary; actorId: string; runId: string }) {
  const { t } = useTranslation("pipelines");
  const { formatDateTime } = useDateFormatting();
  const org = organization.id;
  const handle = organizationHandle(organization);
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const backToActions = repositoryActionsBackPath(handle, search);
  const [run, setRun] = useState<Run>();
  const [definition, setDefinition] = useState<Definition>();
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let timer: ReturnType<typeof setTimeout>;
    let loaded = false;
    setError("");
    async function refresh() {
      try {
        const next = await pipelines.run(org, runId, signal);
        if (signal.aborted) return;
        setRun(next);
        if (!loaded) {
          const { items } = await pipelines.versions(org, next.pipelineId);
          if (signal.aborted) return;
          const version = items.find(v => v.number === next.version);
          if (!version) { setError(t("errors.versionsFailed")); return; }
          setDefinition(version.definition);
          loaded = true;
        }
        setStale(false);
        if (next.status !== "queued" && next.status !== "running") return;
      } catch (cause) {
        if (signal.aborted) return;
        if (!loaded) { setError(translateError(cause, t, "pipelines:errors.requestFailed")); return; }
        setStale(true);
      }
      timer = setTimeout(refresh, 1500);
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [org, runId, retry, t]);
  const inputs = definition?.parameters?.filter(p => p.type !== "secretRef" && Object.hasOwn(run?.inputs ?? {}, p.name)) ?? [];
  const jobs = definition?.stages.flatMap((stage, si) => stage.jobs.map((job, ji) => ({
    key: `${si}.${ji}`, stage: stage.id, job,
  }))) ?? [];
  const eventKind = run?.integration ? (run.integration.queueEntry ? "merge_queue" : "integration")
    : run?.webhook ? "webhook" : run?.trigger?.kind ?? "manual";
  const sourceSHA = run?.integration?.candidateSHA ?? run?.webhook?.sha ??
    (run?.trigger?.kind === "changeset_revision" ? run.trigger.sha : undefined);
  const selection = jobs.find(job => job.key === search.get("job"));
  const returnSearch = new URLSearchParams(search);
  returnSearch.delete("job");
  const returnQuery = backToActions ? `?${returnSearch}` : "";
  function viewQuery(job?: string) {
    const params = new URLSearchParams(returnSearch);
    if (job) params.set("job", job);
    return params.size ? `?${params}` : "";
  }

  return <main className="wf-fullscreen">
    <header className="wf-editor-heading">
      <Link to={backToActions ?? orgPath(handle, "pipelines")}><ArrowLeft size={16} />{backToActions ? t("repositories:actions.back") : t("backToList")}</Link>
      <div className="wf-editor-title"><h1>{run && <PipelineStatusIcon state={run.status} size={22} />}<span>{definition?.name ?? t("runDetails")}</span></h1>
        {run && <span role="status">{t("run", { id: run.id, version: run.version, status: t(run.status) })}</span>}
      </div>
      {run && <Link to={pipelineEditPath(handle, run.pipelineId) + returnQuery}>{t("editPipeline")}</Link>}
    </header>
    {error ? <p className="org-error" role="alert">{error} <Button onClick={() => setRetry(n => n + 1)}>{t("common:actions.refresh")}</Button></p> :
      !definition && <p role="status">{t("common:status.loading")}</p>}
    {stale && <p role="alert">{t("staleRun")}</p>}
    {definition && run && <div className="wf-run-layout">
      <nav className="wf-run-navigation" aria-label={t("runNavigation.title")}>
        <Link to={{ search: viewQuery() }} aria-current={!selection ? "page" : undefined}>
          <LayoutDashboard size={16} aria-hidden="true" />{t("runNavigation.summary")}
        </Link>
        <h2>{t("runNavigation.jobs")}</h2>
        {jobs.map(({ key, stage, job }) => {
          const state = stepGroupState(job.steps.map(step => run.stepStatuses?.[step.id] ?? "queued"));
          return <Link key={key} to={{ search: viewQuery(key) }} aria-current={selection?.key === key ? "page" : undefined}>
            <span>{job.id}<small>{stage}</small></span>
            <PipelineStatusLabel state={state} />
          </Link>;
        })}
      </nav>
      <div className="wf-run-main">
        <RunActions organization={organization} actorId={actorId} run={run} definition={definition} onChanged={next => {
          if (next) void navigate(pipelineRunPath(handle, next.id) + returnQuery);
          else setRetry(n => n + 1);
        }} />
        {selection ? <RunJobLogs key={selection.key} org={org} run={run} job={selection.job} /> : <>
          {run.createdAt && <dl className="wf-run-metadata">
            <div><dt>{t("repositories:actions.event")}</dt><dd>{t(`repositories:actions.events.${eventKind}`)}</dd></div>
            <div><dt>{t("runNavigation.created")}</dt><dd><time dateTime={run.createdAt}>{formatDateTime(run.createdAt)}</time></dd></div>
            {sourceSHA && <div><dt>{t("runNavigation.sourceCommit")}</dt><dd><code>{sourceSHA}</code></dd></div>}
          </dl>}
          {run.trigger?.kind === "rerun" && <Link to={pipelineRunPath(handle, run.trigger.runId) + returnQuery}>{t("runControls.original")}</Link>}
          {inputs.length > 0 && <dl aria-label={t("runParams")} className="wf-run-inputs">
            {inputs.map(p => <div key={p.name}><dt>{p.name}</dt><dd>{String(run.inputs[p.name])}</dd></div>)}
          </dl>}
          <WorkflowCanvas definition={definition} run={run} jobSearch={(si, ji) => viewQuery(`${si}.${ji}`)} />
          <RunArtifacts org={org} run={run} />
        </>}
      </div>
    </div>}
  </main>;
}
