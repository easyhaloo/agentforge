import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { request } from "../../shared/api/identity";
import type { Definition, Run } from "../../shared/api/pipelines";
import { Button, Input } from "../../shared/ui";
import { PipelineStatus } from "./PipelineStatus";

type Output = { id: number; provenance: { name: string; step: string; attempt: number }; expiresAt: string; purgedAt?: string };

function outputBase(org: string, run: Run) {
  return `/api/v1/organizations/${encodeURIComponent(org)}/pipeline-runs/${encodeURIComponent(run.id)}`;
}

export function RunJobLogs({ org, run, job }: { org: string; run: Run; job: Definition["stages"][number]["jobs"][number] }) {
  const { t } = useTranslation("pipelines");
  const base = outputBase(org, run);
  const [retry, setRetry] = useState(0);
  const [logs, setLogs] = useState<ReadonlyMap<string, string[]>>(new Map());
  const [failed, setFailed] = useState(false);
  const [connected, setConnected] = useState(false);
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const steps = job.steps.flatMap(step => {
    const chunks = logs.get(step.id) ?? [];
    const lines = query ? chunks.flatMap(chunk => chunk.split("\n")).filter(line => line.toLowerCase().includes(query)) : chunks;
    return !query || lines.length ? [{ id: step.id, lines }] : [];
  });

  useEffect(() => {
    const steps = new Set(job.steps.map(step => step.id));
    let latest = 0;
    const stream = new EventSource(`${base}/events`);
    stream.onopen = () => { setConnected(true); setFailed(false); };
    stream.onmessage = ({ data }) => {
      const { seq, kind, stepId, message } = JSON.parse(data) as { seq: number; kind: string; stepId?: string; message?: string };
      if (kind === "log" && stepId && steps.has(stepId) && message && seq > latest) {
        latest = seq;
        // ponytail: retain 200 chunks per step. Add log pagination if older chunks need inline access.
        setLogs(previous => new Map(previous).set(stepId, [...(previous.get(stepId) ?? []), message].slice(-200)));
      }
      if (!stepId && ["succeeded", "failed", "cancelled", "timed_out"].includes(kind)) stream.close();
    };
    stream.onerror = () => { if (stream.readyState === EventSource.CLOSED) setFailed(true); };
    return () => stream.close();
  }, [base, job, retry]);

  return <section className="wf-run-output" aria-label={t("job", { id: job.id })}>
    <header className="wf-job-heading">
      <h2>{job.id}</h2>
      <Input type="search" aria-label={t("runOutput.searchLogs")} placeholder={t("runOutput.searchLogs")}
        value={search} onChange={event => setSearch(event.target.value)} />
    </header>
    {failed && <p role="alert">{t("runOutput.unavailable")} <Button onClick={() => {
      setLogs(new Map());
      setConnected(false);
      setRetry(n => n + 1);
    }}>{t("common:actions.retry")}</Button></p>}
    {query && !steps.length && !failed && <p role="status">{t(connected ? "runOutput.noMatches" : "common:status.loading")}</p>}
    {steps.map(({ id, lines }) => {
      const status = run.stepStatuses?.[id] ?? "queued";
      return <details key={id} open={!!query || status === "failed" || status === "timed_out"}>
        <summary><PipelineStatus state={status} />{id}</summary>
        {lines.length
          ? <pre>{lines.join("\n")}</pre>
          : <p>{t(connected || failed ? "runOutput.noLogs" : "common:status.loading")}</p>}
      </details>;
    })}
  </section>;
}

export function RunArtifacts({ org, run }: { org: string; run: Run }) {
  const { t } = useTranslation("pipelines");
  const base = outputBase(org, run);
  const [retry, setRetry] = useState(0);
  const [outputs, setOutputs] = useState<Output[]>();
  const [failed, setFailed] = useState(false);
  const [after, setAfter] = useState(0);
  const stepStatuses = JSON.stringify(run.stepStatuses);

  useEffect(() => {
    const controller = new AbortController();
    request<Output[] | null>(`${base}/objects?after=${after}`, { signal: controller.signal }).then(response => {
      if (controller.signal.aborted) return;
      setOutputs(response ?? []);
      setFailed(false);
    }, () => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [base, after, retry, run.status, stepStatuses]);

  return <section className="wf-run-output" aria-label={t("runOutput.artifacts")}>
    <h2>{t("runOutput.artifacts")}</h2>
    {failed && <p role="alert">{t("runOutput.unavailable")} <Button onClick={() => setRetry(n => n + 1)}>{t("common:actions.retry")}</Button></p>}
    {!failed && !outputs?.length && <p>{t(outputs ? "runOutput.noArtifacts" : "common:status.loading")}</p>}
    {!!outputs?.length && <ul>{outputs.map(({ id, provenance, expiresAt, purgedAt }) => {
      const name = t("runOutput.file", { ...provenance });
      return <li key={id}>{purgedAt || Date.parse(expiresAt) <= Date.now()
        ? <span>{name} · {t("runOutput.expired")}</span>
        : <a href={`${base}/objects/${id}`} download={provenance.name}>{name}</a>}</li>;
    })}</ul>}
    {after > 0 && <Button onClick={() => setAfter(0)}>{t("runOutput.first")}</Button>}
    {outputs?.length === 100 && <Button onClick={() => setAfter(outputs[99].id)}>{t("runOutput.more")}</Button>}
  </section>;
}
