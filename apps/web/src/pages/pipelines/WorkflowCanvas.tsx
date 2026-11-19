import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, GitBranch, Layers, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Definition, Run } from "../../shared/api/pipelines";
import { dependencies } from "./WorkflowEditor";
import "./canvas.css";

function layout(stages: Definition["stages"]) {
  const ids = new Map(stages.map((stage, i) => [stage.id, i]));
  const parents = stages.map((_, i) => dependencies(stages, i).map(id => ids.get(id)));
  const levels = new Map<number, number>();
  const visiting = new Set<number>();
  function level(i: number): number {
    if (levels.has(i)) return levels.get(i)!;
    if (visiting.has(i)) return NaN;
    visiting.add(i);
    const depth = Math.max(0, ...parents[i].map(p => p === undefined ? NaN : level(p) + 1));
    visiting.delete(i);
    levels.set(i, depth);
    return depth;
  }
  const columns: number[][] = [];
  for (let i = 0; i < stages.length; i++) {
    const depth = level(i);
    if (!Number.isFinite(depth) || ids.size !== stages.length) return null;
    (columns[depth] ??= []).push(i);
  }
  return { columns, parents };
}

type StepStatus = NonNullable<Run["stepStatuses"]>[string];
function stageState(states: StepStatus[]) {
  for (const state of ["failed", "timed_out", "leased", "waiting", "cancelled"] as const) {
    if (states.includes(state)) return state;
  }
  if (states.every(s => s === "succeeded")) return "succeeded";
  return states.includes("succeeded") ? "running" : "queued";
}

export function WorkflowCanvas({ definition, run }: { definition: Definition; run?: Run }) {
  const { t } = useTranslation("pipelines");
  const board = useRef<HTMLDivElement>(null);
  const marker = useId().replace(/:/g, "");
  const graph = useMemo(() => layout(definition.stages), [definition]);
  const [paths, setPaths] = useState<string[]>([]);
  useLayoutEffect(() => {
    const root = board.current;
    if (!root || !graph) return;
    const nodes = root.querySelectorAll<HTMLElement>("[data-node]");
    function measure() {
      const origin = root!.getBoundingClientRect();
      const boxes = new Map(Array.from(nodes, node => [Number(node.dataset.node), node.getBoundingClientRect()]));
      setPaths(graph!.parents.flatMap((parents, i) => parents.map(p => {
        const a = boxes.get(p!)!, b = boxes.get(i)!;
        const x = a.right - origin.left, y = a.top - origin.top + 25;
        const end = b.left - origin.left - 3, dest = b.top - origin.top + 25;
        if (end - x > 90) return `M${x} ${y} H${x+18} V12 H${end-18} V${dest} H${end}`;
        return `M${x} ${y} C${(x+end)/2} ${y},${(x+end)/2} ${dest},${end} ${dest}`;
      })));
    }
    measure();
    const observer = new ResizeObserver(measure);
    nodes.forEach(n => observer.observe(n));
    return () => observer.disconnect();
  }, [graph]);
  const badge = (state: string) => <span className="wf-badge" data-state={state}>{t(state === "leased" ? "running" : state)}</span>;
  return <section className="wf-canvas" aria-label={t(run ? "executionCanvas" : "designCanvas")}>
    <header><Workflow size={18}/><strong>{t(run ? "executionCanvas" : "designCanvas")}</strong><span>{definition.name}</span>{run && badge(run.status)}</header>
    {!graph ? <p>{t("invalidGraph")}</p> : <div className="wf-scroll" tabIndex={0}>
      <div ref={board} className="wf-board">
        <svg aria-hidden="true"><defs><marker id={marker} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6Z" fill="#9d9fc1"/></marker></defs>
          {paths.map((d, i) => <path key={i} d={d} fill="none" stroke="#9d9fc1" strokeWidth="1.6" markerEnd={`url(#${marker})`}/>)}</svg>
        {graph.columns.map((col, c) => <div className="wf-column" key={c}>{col.map(i => {
          const stage = definition.stages[i];
          const stateOf = (id: string) => run?.stepStatuses?.[id] ?? "queued";
          const steps = stage.jobs.flatMap(j => j.steps);
          return <details open key={stage.id} data-node={i} className="wf-card">
            <summary><Layers size={15}/><strong>{stage.id}</strong>{run ? badge(stageState(steps.map(s => stateOf(s.id)))) : <small>{steps.length}</small>}<ChevronDown size={14}/></summary>
            <div className="wf-body">{stage.jobs.map(job => <div key={job.id}><b><GitBranch size={12}/>{job.id}</b>
              {job.steps.map(step => <div className="wf-step" key={step.id}><span>{step.id}</span>{run ? badge(stateOf(step.id)) : <small>{t(step.uses === "control/approval@v1" ? "approval" : "container")}</small>}</div>)}
            </div>)}{graph.parents[i].length > 0 && <small className="wf-deps">{t("depends", {id: dependencies(definition.stages, i).join(", ")})}</small>}</div>
          </details>;
        })}</div>)}
      </div></div>}
  </section>;
}
