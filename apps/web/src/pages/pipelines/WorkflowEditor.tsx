import { useState } from "react";
import { WorkflowCanvas, dependencies, type NodePath } from "./WorkflowCanvas";
import { useTranslation } from "react-i18next";
import type { Definition } from "../../shared/api/pipelines";
import { Button, Checkbox, Input, Select, TextArea } from "../../shared/ui";

import { manualInput, ParameterField, parameterTypes, parseValue, displayValue } from "./ParameterField";

type Stage = Definition["stages"][number];
type Capability = Stage["jobs"][number]["steps"][number]["uses"];
/** The capabilities a step can use. The label is a translation key, so the UI shows a translated name. */
export const capabilities = [
  { value: "control/approval@v1", label: "approval" },
  { value: "container/check@v1", label: "container" },
  { value: "container/script@v1", label: "shell" },
] satisfies { value: Capability; label: string }[];

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
// Check saved definitions before passing them to the canvas and its controls.
export function editable(d: Definition) {
  return d?.apiVersion === "agentforge.dev/v1" && typeof d.name === "string" && Array.isArray(d.stages) && d.stages.every(s =>
    typeof s?.id === "string" && (s.dependsOn == null || strings(s.dependsOn)) && Array.isArray(s.jobs) && s.jobs.every(j =>
      typeof j?.id === "string" && Array.isArray(j.steps) && j.steps.every(p => typeof p?.id === "string" && (p.secretParams === undefined || strings(p.secretParams)) && (p.outputs === undefined || strings(p.outputs)) && (p.script === undefined || typeof p.script === "string") && capabilities.some(c => c.value === p.uses)))) &&
    (d.parameters === undefined || (Array.isArray(d.parameters) && d.parameters.every(p => typeof p?.name === "string" && parameterTypes.includes(p.type) &&
      (p.choices === undefined || strings(p.choices)) && (p.default === undefined || ["number", "string", "boolean"].includes(typeof p.default) || strings(p.default)))));
}

export function workflowOutputNames(d: Definition) {
  return d.stages.flatMap(stage => stage.jobs.flatMap(job => job.steps.flatMap(step => step.outputs ?? [])));
}

export function outputNameError(name: string, names: string[]) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) return "invalidOutputName";
  if (names.indexOf(name) !== names.lastIndexOf(name)) return "duplicateOutputName";
}

export function WorkflowEditor({ definition, update, outputNames }: { definition: Definition; update: (value: Definition) => void; outputNames: string[] }) {
  const { t } = useTranslation("pipelines");
  function change(mutate: (next: Definition) => void) {
    const next = structuredClone(definition);
    mutate(next);
    update(next);
  }
  function newJob(d: Definition) {
    return { id: nextID(d, "job"), steps: [{ id: nextID(d, "step"), uses: capabilities[0].value }] };
  }
  const [path, select] = useState<NodePath>([]);
  const [si, ji, pi] = path;
  const stage = si === undefined ? undefined : definition.stages[si];
  const job = ji === undefined ? undefined : stage?.jobs[ji];
  const step = pi === undefined ? undefined : job?.steps[pi];
  return <div className="wf-designer">
    <WorkflowCanvas definition={definition} selection={path} onSelect={select} toolbar={<>
      <Button aria-pressed={!path.length} onClick={() => select([])}>{t("workflowSettings")}</Button>
      <Button disabled={definition.stages.length >= 64} onClick={() => {
        change(d => { d.stages.push({ id: nextID(d, "stage"), jobs: [newJob(d)] }); });
        select([definition.stages.length]);
      }}>{t("addStage")}</Button>
    </>} />
    <aside aria-label={t("visual")} className="workflow-editor">
      {!stage && <><strong>{t("workflowSettings")}</strong>
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
            <Select label={t("inputMode")} value={manualInput(p) ? "manual" : "default"}
              options={[{ value: "default", label: t("defaultMode") }, { value: "manual", label: t("manualMode") }]}
              onChange={e => set(e.target.value === "manual" ? { required: true, override: true, default: undefined } : { required: false })} />
            {!manualInput(p) && <>
              <ParameterField parameter={p} label={t("default")} value={displayValue(p.default)} change={value => set({ default: parseValue(p.type, value) })} />
              <Checkbox label={t("override")} checked={!!p.override} onChange={e => set({ override: e.target.checked })} />
            </>}
            <Button onClick={() => change(d => { d.parameters!.splice(index, 1); updateBindings(d); })}>{t("removeParameter")}</Button>
          </fieldset>;
        })}
        <Button disabled={(definition.parameters?.length ?? 0) >= 64} onClick={() => change(d => {
          const params = d.parameters ??= [];
          let n = 1;
          while (params.some(p => p.name === `param${n}`)) n++;
          params.push({ name: `param${n}`, type: "string", override: true });
        })}>{t("addParameter")}</Button>
      </>}
      {si !== undefined && stage && !job && <fieldset>
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
        <Button disabled={stage.jobs.length >= 64} onClick={() => {
          change(d => { d.stages[si].jobs.push(newJob(d)); });
          select([si, stage.jobs.length]);
        }}>{t("addJob")}</Button>
        <Button disabled={definition.stages.length === 1} onClick={() => {
          change(d => {
            d.stages.splice(si, 1);
            for (const s of d.stages) if (s.dependsOn) s.dependsOn = s.dependsOn.filter(id => id !== stage.id);
          });
          select([]);
        }}>{t("removeStage")}</Button>
      </fieldset>}
      {si !== undefined && ji !== undefined && stage && job && !step && <fieldset>
        <legend>{t("job", {id:job.id})}</legend>
        <Input label={t("jobID")} value={job.id} onChange={e => change(d => { d.stages[si].jobs[ji].id = e.target.value; })} />
        <Button disabled={job.steps.length >= 64} onClick={() => {
          change(d => { d.stages[si].jobs[ji].steps.push({ id: nextID(d, "step"), uses: capabilities[0].value }); });
          select([si, ji, job.steps.length]);
        }}>{t("addStep")}</Button>
        <Button disabled={stage.jobs.length === 1} onClick={() => {
          change(d => { d.stages[si].jobs.splice(ji, 1); });
          select([si]);
        }}>{t("removeJob")}</Button>
      </fieldset>}
      {si !== undefined && ji !== undefined && pi !== undefined && job && step && <fieldset>
        <legend>{t("step", {id:step.id})}</legend>
        <Input label={t("stepID")} value={step.id} onChange={e => change(d => { d.stages[si].jobs[ji].steps[pi].id = e.target.value; })} />
        <Select label={t("capability", {id:step.id})} options={capabilities.map(c => ({ ...c, label: t(c.label) }))} value={step.uses} onChange={e => change(d => { const current = d.stages[si].jobs[ji].steps[pi];
          current.uses = e.target.value as Capability;
          if (current.uses === "container/script@v1") current.script ??= 'printf "Hello from the pipeline\\n"';
          else { delete current.script; delete current.outputs; }
          if (current.uses !== "container/check@v1") delete current.secretParams; })} />
        {step.uses === "container/script@v1" && <>
          <TextArea label={t("scriptBody")} rows={8} spellCheck={false} value={step.script ?? ""}
            onChange={e => change(d => { d.stages[si].jobs[ji].steps[pi].script = e.target.value; })} />
          <fieldset>
            <legend>{t("outputNames")}</legend>
            {(step.outputs ?? []).map((name, index) => {
              const error = outputNameError(name, outputNames);
              return <div className="wf-variable-row" key={index}>
                <Input aria-label={t("outputName", { number: index + 1 })} placeholder="BUILD_TAG" value={name}
                  spellCheck={false} maxLength={64} error={error && t(error)}
                  onChange={e => change(d => { d.stages[si].jobs[ji].steps[pi].outputs![index] = e.target.value; })} />
                <Button size="small" aria-label={t("removeOutput", { number: index + 1 })}
                  onClick={() => change(d => { d.stages[si].jobs[ji].steps[pi].outputs!.splice(index, 1); })}>
                  {t("common:actions.delete")}
                </Button>
              </div>;
            })}
            <Button disabled={(step.outputs?.length ?? 0) >= 16 || outputNames.length >= 64} onClick={() => change(d => {
              const outputs = d.stages[si].jobs[ji].steps[pi].outputs ??= [];
              let n = 1;
              while (outputNames.includes(`OUTPUT_${n}`)) n++;
              outputs.push(`OUTPUT_${n}`);
            })}>{t("addOutput")}</Button>
          </fieldset>
          <small>{t("scriptHelp")}</small>
        </>}
        {step.uses === "container/check@v1" && definition.parameters?.filter(p => p.type === "secretRef").map((p, i) =>
          <Checkbox key={i} label={t("bindSecret", { name: p.name })} checked={step.secretParams?.includes(p.name) ?? false}
            onChange={e => change(d => { const current = d.stages[si].jobs[ji].steps[pi];
              current.secretParams = e.target.checked ? [...(current.secretParams ?? []), p.name] : current.secretParams?.filter(name => name !== p.name);
            })} />)}
        <Button disabled={pi === 0} onClick={() => change(d => {
          const steps = d.stages[si].jobs[ji].steps;
          [steps[pi - 1], steps[pi]] = [steps[pi], steps[pi - 1]]; select([si, ji, pi - 1]);
        })}>{t("moveEarlier")}</Button>
        <Button disabled={job.steps.length === 1} onClick={() => {
          change(d => { d.stages[si].jobs[ji].steps.splice(pi, 1); });
          select([si, ji]);
        }}>{t("removeStep")}</Button>
      </fieldset>}
    </aside>
  </div>;
}
