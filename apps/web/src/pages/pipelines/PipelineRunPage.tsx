import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { translateError } from "../../shared/api/errors";
import type { OrganizationSummary } from "../../shared/api/identity";
import { pipelines, type Definition, type Run } from "../../shared/api/pipelines";
import { organizationHandle, orgPath, pipelineEditPath } from "../../shared/routing";
import { Button } from "../../shared/ui";
import { WorkflowCanvas } from "./WorkflowCanvas";

export function PipelineRunPage({ organization, runId }: { organization: OrganizationSummary; runId: string }) {
  const { t } = useTranslation("pipelines");
  const org = organization.id;
  const handle = organizationHandle(organization);
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
  return <main className="wf-fullscreen">
    <header className="wf-editor-heading">
      <Link to={orgPath(handle, "pipelines")}><ArrowLeft size={16} />{t("backToList")}</Link>
      <div className="wf-editor-title"><h1>{t("runDetails")}</h1>
        {run && <span role="status">{t("run", { id: run.id, version: run.version, status: t(run.status) })}</span>}
      </div>
      {run && <Link to={pipelineEditPath(handle, run.pipelineId)}>{t("editPipeline")}</Link>}
    </header>
    {error ? <p className="org-error" role="alert">{error} <Button onClick={() => setRetry(n => n + 1)}>{t("common:actions.refresh")}</Button></p> :
      !definition && <p role="status">{t("common:status.loading")}</p>}
    {run && inputs.length > 0 && <dl aria-label={t("runParams")} className="wf-run-inputs">
      {inputs.map(p => <div key={p.name}><dt>{p.name}</dt><dd>{String(run.inputs[p.name])}</dd></div>)}
    </dl>}
    {stale && <p role="alert">{t("staleRun")}</p>}
    {definition && run && <WorkflowCanvas definition={definition} run={run} />}
  </main>;
}
