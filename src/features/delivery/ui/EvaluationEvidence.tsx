import { Check, CircleAlert, ShieldCheck } from "lucide-react";
import type { Evaluation } from "../model";

type Props = { evaluations: Evaluation[]; evidenceCurrent: boolean };

export function EvaluationEvidence({ evaluations, evidenceCurrent }: Props) {
  return <div className="flow-subsection">
    <div className="flow-subhead"><h4><ShieldCheck size={14} /> Evaluation evidence</h4><span>{evidenceCurrent ? "Current" : "Stale"}</span></div>
    {evaluations.slice(0, 3).map((evaluation) => <div className="evidence-row" key={evaluation.id}>
      <span className={evaluation.status === "Passed" ? "evidence-icon pass" : "evidence-icon fail"}>
        {evaluation.status === "Passed" ? <Check size={13} /> : <CircleAlert size={13} />}
      </span>
      <div><b>{evaluation.id} · r{evaluation.revision}</b><small>{evaluation.checks} checks · {evaluation.createdAt}</small></div>
      <strong>{evaluation.status}</strong>
    </div>)}
  </div>;
}
