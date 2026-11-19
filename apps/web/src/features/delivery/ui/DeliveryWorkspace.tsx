import { Play, Plus, RefreshCw, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Input } from "../../../shared/ui";
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
  const { t } = useTranslation("common");
  const {
    change, currentRevisionNumber, title, evaluations, evaluationViews, reviews, currentRevisionId, evidenceCurrent, approved,
    trailDone, stackBase, onTitleChange, onTitleCommit, onCreateRevision,
    onRunEvaluation, onSelfHeal, onRestack, onDecide, onMerge,
  } = props;

  // The status the API reports and the wording the interface shows.
  const statusLabels: Record<string, string> = {
    "Draft": t("delivery.status.draft"),
    "Evaluating": t("delivery.status.evaluating"),
    "Ready for review": t("delivery.status.readyForReview"),
    "Changes requested": t("delivery.status.changesRequested"),
    "Approved": t("delivery.status.approved"),
    "Merged": t("delivery.status.merged"),
  };

  return <section className="card flow-primary">
    <div className="flow-section-head">
      <div><span className="eyebrow">{t("delivery.workspace.eyebrow")}</span><h3>{change.id} <span className="revision-chip">r{currentRevisionNumber}</span></h3>
        <p>{t("delivery.workspace.identityHint")}</p>
      </div>
      <span className={"resource-status " + (change.status === "Merged" ? "flow-good" : "")}>{statusLabels[change.status] ?? change.status}</span>
    </div>
    <Input label={t("delivery.workspace.titleLabel")} value={title} onChange={(event) => onTitleChange(event.target.value)} onBlur={onTitleCommit} />
    <div className="flow-facts">
      <div><span>{t("delivery.workspace.baseBranch")}</span><b>{change.base}</b></div>
      <div><span>{t("delivery.workspace.changedFiles")}</span><b>{change.files}</b></div>
      <div><span>{t("delivery.workspace.stackBase")}</span><b>{stackBase}</b></div>
    </div>
    <div className="flow-actions">
      <Button variant="secondary" size="small" className="compact" onClick={onCreateRevision}><Plus size={14} /> {t("delivery.workspace.newRevision")}</Button>
      <Button variant="primary" size="small" className="compact" onClick={onRunEvaluation}><Play size={14} /> {t("delivery.workspace.runEvaluation")}</Button>
      <Button variant="secondary" size="small" className="compact" onClick={onSelfHeal}><Sparkles size={14} /> {t("delivery.workspace.selfHeal")}</Button>
      <Button variant="secondary" size="small" className="compact" onClick={onRestack}><RefreshCw size={14} /> {t("delivery.workspace.restack")}</Button>
    </div>
    <EvaluationEvidence evaluations={evaluationViews} evidenceCurrent={evidenceCurrent} />
    <ReviewDecision currentRevisionId={currentRevisionId} latestEvaluation={evaluations[0]} reviews={reviews} onDecide={onDecide} />
    <TrailSummary trailDone={trailDone} stackBase={stackBase} approved={approved} onMerge={onMerge} />
  </section>;
}
