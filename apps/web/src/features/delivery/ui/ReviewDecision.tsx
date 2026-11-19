import { CheckCircle2, GitPullRequest } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui";
import { canApproveRevision } from "../../../domain/delivery";
import type { RevisionId } from "../../../entities";
import type { Evaluation, ReviewView } from "../model";

type Props = {
  currentRevisionId: RevisionId;
  latestEvaluation: Evaluation | undefined;
  reviews: ReviewView[];
  onDecide: (decision: "Approved" | "Changes requested") => void;
};

export function ReviewDecision({ currentRevisionId, latestEvaluation, reviews, onDecide }: Props) {
  const { t } = useTranslation("common");
  const canReview = canApproveRevision(currentRevisionId, latestEvaluation);
  const latestReview = reviews[0];

  // The decision the API reports and the wording the interface shows.
  const decisionLabels: Record<string, string> = {
    "Pending": t("delivery.review.pending"),
    "Approved": t("delivery.review.approved"),
    "Changes requested": t("delivery.review.changesRequested"),
  };
  const reviewerLabel = (reviewer: string) => reviewer === "You" ? t("delivery.review.you") : reviewer;

  return <div className="flow-subsection">
    <div className="flow-subhead"><h4><GitPullRequest size={14} /> {t("delivery.review.title")}</h4><span>{latestReview ? decisionLabels[latestReview.decision] : t("delivery.review.notRequested")}</span></div>
    {reviews.slice(0, 3).map((review) => <div className="evidence-row" key={review.id}>
      <span className="evidence-icon review"><GitPullRequest size={13} /></span>
      <div><b>{review.id} · r{review.revisionNumber ?? "?"}</b><small>{reviewerLabel(review.reviewer)} · {t("delivery.review.revisionScoped")}</small></div>
      <strong>{decisionLabels[review.decision]}</strong>
    </div>)}
    <div className="flow-actions review-actions">
      <Button variant="secondary" size="small" className="compact" disabled={!canReview} onClick={() => onDecide("Changes requested")}>{t("delivery.review.requestChanges")}</Button>
      <Button variant="primary" size="small" className="compact" disabled={!canReview} onClick={() => onDecide("Approved")}><CheckCircle2 size={14} /> {t("delivery.review.approveRevision")}</Button>
    </div>
  </div>;
}
