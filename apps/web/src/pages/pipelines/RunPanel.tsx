import { useTranslation } from "react-i18next";
import { useState } from "react";
import { pipelines, type Pipeline, type Version, type Run } from "../../shared/api/pipelines";
import { Button, Select } from "../../shared/ui";

import { ParameterField, parseValue, displayValue } from "./ParameterField";

import { MergeQueuePanel } from "./MergeQueuePanel";

export function RunPanel({ org, pipeline, canStart, canPromote }: { org: string; pipeline: Pipeline; canStart: boolean; canPromote: boolean }) {
  const { t } = useTranslation("pipelines");
  const [versions, setVersions] = useState<Version[]>([]);
  const [number, setNumber] = useState(pipeline.version);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [run, setRun] = useState<Run>();
  const version = versions.find(v => v.number === number);
  const params = version?.definition.parameters ?? [];
  async function load() {
    setBusy(true); setError("");
    try { setVersions((await pipelines.versions(org, pipeline.id)).items); }
    catch (e) { setError(e instanceof Error ? e.message : t("loadError")); }
    finally { setBusy(false); }
  }
  function inputs() {
      const inputs: Record<string, unknown> = Object.create(null);
      for (const p of params) if (p.override && Object.hasOwn(values, p.name) && values[p.name] !== "") inputs[p.name] = parseValue(p.type, values[p.name]);
      return inputs;
  }
  async function start() {
    setBusy(true); setError("");
    try {
      setRun(await pipelines.start(org, pipeline.id, number, inputs()));
    } catch (e) { setError(e instanceof Error ? e.message : t("startError")); }
    finally { setBusy(false); }
  }
  return <section><h3>{t("versions")}</h3>
    {!version && <Button disabled={busy} onClick={() => void load()}>{t("viewVersions")}</Button>}
    {version && <>
      <Select label={t("version")} value={number} options={versions.map(v => ({ value: String(v.number), label: `${v.number} · ${v.checksum.slice(0, 12)}` }))} disabled={busy}
        onChange={e => { setNumber(Number(e.target.value)); setValues({}); setError(""); }} />
      <form onSubmit={e => { e.preventDefault(); void start(); }}><fieldset disabled={busy || !canStart}>
        <legend>{t("runParams")}</legend>
        {params.map(p => <ParameterField key={p.name} label={p.name} parameter={p} disabled={!p.override} required={p.required && p.default === undefined}
          value={Object.hasOwn(values, p.name) ? values[p.name] : displayValue(p.default)} change={value => setValues({ ...values, [p.name]: value })} />)}
        {canStart && <Button type="submit" variant="primary">{t("start")}</Button>}
      </fieldset></form>
      <MergeQueuePanel org={org} pipeline={pipeline.id} version={number} canStart={canStart} canPromote={canPromote} inputs={inputs} />
    </>}
    {error && <p role="alert">{error}</p>}
    {run && <p role="status">{t("run", {id:run.id, version:run.version, status:t(run.status, run.status)})}</p>}
  </section>;
}
