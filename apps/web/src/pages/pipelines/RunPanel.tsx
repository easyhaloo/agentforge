import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { translateError } from "../../shared/api/errors";
import { pipelines, type Definition, type Pipeline, type Version, type Run } from "../../shared/api/pipelines";
import { Button, Modal, Select } from "../../shared/ui";

import { manualInput, ParameterField, parseValue, displayValue } from "./ParameterField";

import { WorkflowCanvas } from "./WorkflowCanvas";


export type RunVersion = Pick<Version, "number" | "definition">;
export type DraftRun = {
  definition: Definition;
  publish?: () => Promise<Pipeline>;
};

export function RunDialog({ org, pipeline, draft, onCancel, onSubmit, queue = false }: {
  org: string; pipeline: Pipeline; draft?: DraftRun; onCancel: () => void; queue?: boolean;
  onSubmit: (version: RunVersion, inputs: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useTranslation("pipelines");
  const [versions, setVersions] = useState<Version[]>([]);
  const [number, setNumber] = useState(draft ? 0 : pipeline.version);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const version = versions.find(v => v.number === number);
  const usingDraft = number === 0 && !!draft;
  const definition = usingDraft ? draft.definition : version?.definition;
  const params = definition?.parameters ?? [];
  useEffect(() => {
    if (!pipeline.version) return;
    let active = true;
    setError("");
    pipelines.versions(org, pipeline.id).then(({ items }) => {
      if (!active) return;
      if (items.some(v => v.number === pipeline.version)) setVersions(items);
      else setError(t("errors.versionsFailed"));
    }).catch(e => { if (active) setError(translateError(e, t, "pipelines:errors.versionsFailed")); });
    return () => { active = false; };
  }, [org, pipeline.id, pipeline.version, retry, t]);
  const missing = params.some(p => manualInput(p) && (!Object.hasOwn(values, p.name) || values[p.name] === ""));
  async function submit() {
    if (!definition || missing || !form.current?.reportValidity()) return;
    const inputs: Record<string, unknown> = Object.create(null);
    for (const p of params) {
      if (p.override && Object.hasOwn(values, p.name) && values[p.name] !== "") inputs[p.name] = parseValue(p.type, values[p.name]);
    }
    let target: RunVersion | undefined = version;
    if (usingDraft && draft.publish) {
      const published = await draft.publish();
      setNumber(published.version);
      target = { number: published.version, definition: published.definition };
    }
    if (!target) return;
    await onSubmit(target, inputs);
    onCancel();
  }
  return <Modal open title={t(queue ? "enqueue" : "runWorkflow")} onCancel={onCancel} okText={t(usingDraft ? (queue ? "publishAndEnqueue" : "publishAndStart") : (queue ? "enqueue" : "start"))}
    onOk={submit} okDisabled={!definition || missing || (usingDraft && !draft.publish)}>
    {error && <p role="alert">{error} <Button onClick={() => { setError(""); setRetry(n => n + 1); }}>{t("common:actions.refresh")}</Button></p>}
    {!definition && !error ? <p role="status">{t("common:status.loading")}</p> :
      definition && <form ref={form} className="wf-create-fields" onSubmit={e => e.preventDefault()}>
        <Select label={t(draft ? "configurationVersion" : "version")} value={String(number)} options={[
          ...(draft ? [{ value: "0", label: t("currentDraft") }] : []),
          ...versions.map(v => ({ value: String(v.number), label: `${v.number} · ${v.checksum.slice(0, 12)}` })),
        ]}
          onChange={e => { setNumber(Number(e.target.value)); setValues({}); }} />
        {usingDraft && <small>{t(draft.publish ? "draftRunHint" : "draftPublishUnavailable")}</small>}
        {params.map(p => <div key={p.name}>
          <ParameterField parameter={p} label={p.name} disabled={!p.override} required={p.required && p.default === undefined}
            value={Object.hasOwn(values, p.name) ? values[p.name] : displayValue(p.default)} change={value => setValues({ ...values, [p.name]: value })} />
          <small>{t(manualInput(p) ? "manualMode" : p.default === undefined ? "optionalInput" : p.override ? "editableDefault" : "fixedDefault")}</small>
        </div>)}
      </form>}
  </Modal>;
}

export function LiveRun({ org, receipt, version }: { org: string; receipt: Run; version: RunVersion }) {
  const { t } = useTranslation("pipelines");
  const [snapshot, setSnapshot] = useState(receipt);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await pipelines.run(org, receipt.id, controller.signal);
        if (controller.signal.aborted) return;
        setSnapshot(next);
        setStale(false);
        if (next.status !== "queued" && next.status !== "running") return;
      } catch {
        if (controller.signal.aborted) return;
        setStale(true);
      }
      timer = setTimeout(refresh, 1500);
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [org, receipt.id]);
  return <div>
    <p role="status">{t("run", {id:receipt.id, version:receipt.version, status:t(snapshot.status)})}</p>
    {stale && <p role="alert">{t("staleRun")}</p>}
    <WorkflowCanvas definition={version.definition} run={snapshot}/>
  </div>;
}
