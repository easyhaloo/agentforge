import { Play, Plus, RefreshCw, Sparkles } from "lucide-react";
import type { RevisionId } from "../../../entities";
import type { Change, Evaluation, EvaluationView, ReviewView } from "../model";
import { EvaluationEvidence } from "./EvaluationEvidence";
import { ReviewDecision } from "./ReviewDecision";
import { TrailSummary } from "./TrailSummary";

type Props = {
  change: Change; currentRevisionNumber: number; title: string; evaluations: Evaluation[]; evaluationViews: EvaluationView[]; reviews: ReviewView[];
  currentRevisionId: RevisionId; evidenceCurrent: boolean; approved: boolean;
  trailDone: boolean; stackBase: string;
  onTitleChange: (title: string) => void; onTitleCommit: () => void;
  onCreateRevision: () => void; onRunEvaluation: () => void; onSelfHeal: () => void;
  onRestack: () => void; onDecide: (decision: "Approved" | "Changes requested") => void;
  onMerge: () => void;
};

export function DeliveryWorkspace(props: Props) {
  const {
    change, currentRevisionNumber, title, evaluations, evaluationViews, reviews, currentRevisionId, evidenceCurrent, approved,
    trailDone, stackBase, onTitleChange, onTitleCommit, onCreateRevision,
    onRunEvaluation, onSelfHeal, onRestack, onDecide, onMerge,
  } = props;

  return <section className="card flow-primary">
    <div className="flow-section-head">
      <div><span className="eyebrow">ACTIVE CHANGESET</span><h3>{change.id} <span className="revision-chip">r{currentRevisionNumber}</span></h3>
        <p>Changeset ID is stable across revisions; Git commit SHAs are separate objects.</p>
      </div>
      <span className={"resource-status " + (change.status === "Merged" ? "flow-good" : "")}>{change.status}</span>
    </div>
    <label className="flow-label">Change title
      <input value={title} onChange={(event) => onTitleChange(event.target.value)} onBlur={onTitleCommit} />
    </label>
    <div className="flow-facts">
      <div><span>Base branch</span><b>{change.base}</b></div>
      <div><span>Changed files</span><b>{change.files}</b></div>
      <div><span>Stack base</span><b>{stackBase}</b></div>
    </div>
    <div className="flow-actions">
      <button className="button secondary compact" onClick={onCreateRevision}><Plus size={14} /> New revision</button>
      <button className="button primary compact" onClick={onRunEvaluation}><Play size={14} /> Run Eval</button>
      <button className="button secondary compact" onClick={onSelfHeal}><Sparkles size={14} /> Self-heal</button>
      <button className="button secondary compact" onClick={onRestack}><RefreshCw size={14} /> Restack</button>
    </div>
    <EvaluationEvidence evaluations={evaluationViews} evidenceCurrent={evidenceCurrent} />
    <ReviewDecision currentRevisionId={currentRevisionId} latestEvaluation={evaluations[0]} reviews={reviews} onDecide={onDecide} />
    <TrailSummary trailDone={trailDone} stackBase={stackBase} approved={approved} onMerge={onMerge} />
  </section>;
}
