import { useTranslation } from "react-i18next";
import type { Definition } from "../../shared/api/pipelines";
import { Button, Checkbox, Input, Select, TextArea } from "../../shared/ui";

import { ParameterField, parameterTypes, parseValue, displayValue } from "./ParameterField";

type Stage = Definition["stages"][number];
type Capability = Stage["jobs"][number]["steps"][number]["uses"];
/** The capabilities a step can use. The label is a translation key, so the UI shows a translated name. */
export const capabilities = [
  { value: "control/approval@v1", label: "approval" },
  { value: "container/check@v1", label: "container" },
] satisfies { value: Capability; label: string }[];

export function dependencies(stages: Stage[], index: number): string[] {
  return stages[index].dependsOn ?? (index ? [stages[index - 1].id] : []);
}
function nextID(d: Definition, prefix: string) {
  const ids = new Set(d.stages.flatMap(s => [s.id, ...s.jobs.flatMap(j => [j.id, ...j.steps.map(step => step.id)])]));
  let suffix = 1;
  while (ids.has(prefix + suffix)) suffix++;
  return prefix + suffix;
}
function reaches(stages: Stage[], from: string, target: string, seen = new Set<string>()): boolean {
  if (from === target) return true;
  const index = stages.findIndex(s => s.id === from);
  if (index < 0 || seen.has(from)) return false;
  seen.add(from);
  return dependencies(stages, index).some(id => reaches(stages, id, target, seen));
}

const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(i => typeof i === "string");
// JSON can be edited freely. Check the shape consumed by the controls before mounting them.
export function editable(d: Definition) {
  return d?.apiVersion === "agentforge.dev/v1" && typeof d.name === "string" && Array.isArray(d.stages) && d.stages.every(s =>
    typeof s?.id === "string" && (s.dependsOn == null || strings(s.dependsOn)) && Array.isArray(s.jobs) && s.jobs.every(j =>
      typeof j?.id === "string" && Array.isArray(j.steps) && j.steps.every(p => typeof p?.id === "string" && (p.secretParams === undefined || strings(p.secretParams)) && capabilities.some(c => c.value === p.uses)))) &&
    (d.parameters === undefined || (Array.isArray(d.parameters) && d.parameters.every(p => typeof p?.name === "string" && parameterTypes.includes(p.type) &&
      (p.choices === undefined || strings(p.choices)) && (p.default === undefined || ["number", "string", "boolean"].includes(typeof p.default) || strings(p.default)))));
}

export function WorkflowEditor({ definition, update }: { definition: Definition; update: (value: Definition) => void }) {
  const { t } = useTranslation("pipelines");
  function change(mutate: (next: Definition) => void) {
    const next = structuredClone(definition);
    mutate(next);
    update(next);
  }
  function newJob(d: Definition) {
    return { id: nextID(d, "job"), steps: [{ id: nextID(d, "step"), uses: capabilities[0].value }] };
  }
  return <div className="workflow-editor">
    <Input label={t("workflowName")} value={definition.name} onChange={e => change(d => { d.name = e.target.value; })} />
    {(definition.parameters ?? []).map((p, index) => {
      const updateBindings = (d: Definition, name?: string) => {
        for (const stage of d.stages) for (const job of stage.jobs) for (const step of job.steps) {
          if (step.secretParams) step.secretParams = step.secretParams.flatMap(ref => ref !== p.name ? [ref] : name ? [name] : []);
        }
      };
      const set = (patch: Partial<typeof p>) => change(d => {
        Object.assign(d.parameters![index], patch);
        if (p.type === "secretRef" && (patch.name !== undefined || patch.type !== undefined)) updateBindings(d, patch.name);
      });
      return <fieldset key={index}><legend>{t("parameter", { name: p.name })}</legend>
        <Input label={t("parameterName")} value={p.name} onChange={e => set({ name: e.target.value })} />
        <Select label={t("parameterType")} value={p.type} options={parameterTypes.map(type => ({ value: type, label: type }))}
          onChange={e => set({ type: e.target.value as typeof p.type, default: undefined, choices: e.target.value === "choice" ? [] : undefined })} />
        {p.type === "choice" && <TextArea label={t("choices")} value={p.choices?.join("\n") ?? ""} onChange={e => set({ choices: e.target.value.split("\n") })} />}
        <ParameterField parameter={p} label={t("default")} value={displayValue(p.default)} change={value => set({ default: parseValue(p.type, value) })} />
        <Checkbox label={t("required")} checked={!!p.required} onChange={e => set({ required: e.target.checked })} />
        <Checkbox label={t("override")} checked={!!p.override} onChange={e => set({ override: e.target.checked })} />
        <Button onClick={() => change(d => { d.parameters!.splice(index, 1); updateBindings(d); })}>{t("removeParameter")}</Button>
      </fieldset>;
    })}
    <Button disabled={(definition.parameters?.length ?? 0) >= 64} onClick={() => change(d => {
      const params = d.parameters ??= [];
      let n = 1;
      while (params.some(p => p.name === `param${n}`)) n++;
      params.push({ name: `param${n}`, type: "string", override: true });
    })}>{t("addParameter")}</Button>
    {definition.stages.map((stage, si) => <fieldset key={si}>
      <legend>{t("stage", {id:stage.id})}</legend>
      <Input label={t("stageID")} value={stage.id} onChange={e => change(d => {
        d.stages[si].id = e.target.value;
        for (const other of d.stages) if (other.dependsOn) other.dependsOn = other.dependsOn.map(id => id === stage.id ? e.target.value : id);
      })} />
      {definition.stages.filter(s => s !== stage).map((s, i) => {
        const deps = dependencies(definition.stages, si);
        return <Checkbox key={i} label={t("depends", {id:s.id})} checked={deps.includes(s.id)}
          disabled={!deps.includes(s.id) && reaches(definition.stages, s.id, stage.id)}
          onChange={e => change(d => { d.stages[si].dependsOn = e.target.checked ? [...deps, s.id] : deps.filter(id => id !== s.id); })} />;
      })}
      {stage.jobs.map((job, ji) => <fieldset key={ji}>
        <legend>{t("job", {id:job.id})}</legend>
        <Input label={t("jobID")} value={job.id} onChange={e => change(d => { d.stages[si].jobs[ji].id = e.target.value; })} />
        <ol>{job.steps.map((step, pi) => <li key={pi}>
          <Input label={t("stepID")} value={step.id} onChange={e => change(d => { d.stages[si].jobs[ji].steps[pi].id = e.target.value; })} />
          <Select label={t("capability", {id:step.id})} options={capabilities.map(c => ({ ...c, label: t(c.label) }))} value={step.uses} onChange={e => change(d => { const current = d.stages[si].jobs[ji].steps[pi];
            current.uses = e.target.value as Capability;
            if (current.uses !== "container/check@v1") delete current.secretParams; })} />
          {step.uses === "container/check@v1" && definition.parameters?.filter(p => p.type === "secretRef").map((p, i) =>
            <Checkbox key={i} label={t("bindSecret", { name: p.name })} checked={step.secretParams?.includes(p.name) ?? false}
              onChange={e => change(d => { const current = d.stages[si].jobs[ji].steps[pi];
                current.secretParams = e.target.checked ? [...(current.secretParams ?? []), p.name] : current.secretParams?.filter(name => name !== p.name);
              })} />)}
          <Button disabled={pi === 0} onClick={() => change(d => {
            const steps = d.stages[si].jobs[ji].steps;
            [steps[pi - 1], steps[pi]] = [steps[pi], steps[pi - 1]];
          })}>{t("moveEarlier")}</Button>
          <Button disabled={job.steps.length === 1} onClick={() => change(d => { d.stages[si].jobs[ji].steps.splice(pi, 1); })}>{t("removeStep")}</Button>
        </li>)}</ol>
        <Button disabled={job.steps.length >= 64} onClick={() => change(d => { d.stages[si].jobs[ji].steps.push({ id: nextID(d, "step"), uses: capabilities[0].value }); })}>{t("addStep")}</Button>
        <Button disabled={stage.jobs.length === 1} onClick={() => change(d => { d.stages[si].jobs.splice(ji, 1); })}>{t("removeJob")}</Button>
      </fieldset>)}
      <Button disabled={stage.jobs.length >= 64} onClick={() => change(d => { d.stages[si].jobs.push(newJob(d)); })}>{t("addJob")}</Button>
      <Button disabled={definition.stages.length === 1} onClick={() => change(d => {
        d.stages.splice(si, 1);
        for (const s of d.stages) if (s.dependsOn) s.dependsOn = s.dependsOn.filter(id => id !== stage.id);
      })}>{t("removeStage")}</Button>
    </fieldset>)}
    <Button disabled={definition.stages.length >= 64} onClick={() => change(d => { d.stages.push({ id: nextID(d, "stage"), jobs: [newJob(d)] }); })}>{t("addStage")}</Button>
  </div>;
}
