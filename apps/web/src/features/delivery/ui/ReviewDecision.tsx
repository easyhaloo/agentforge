import { CheckCircle2, GitPullRequest } from "lucide-react";
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
  const canReview = canApproveRevision(currentRevisionId, latestEvaluation);
  const latestReview = reviews[0];

  return <div className="flow-subsection">
    <div className="flow-subhead"><h4><GitPullRequest size={14} /> Review decision</h4><span>{latestReview?.decision ?? "Not requested"}</span></div>
    {reviews.slice(0, 3).map((review) => <div className="evidence-row" key={review.id}>
      <span className="evidence-icon review"><GitPullRequest size={13} /></span>
      <div><b>{review.id} · r{review.revisionNumber ?? "?"}</b><small>{review.reviewer} · revision-scoped review</small></div>
      <strong>{review.decision}</strong>
    </div>)}
    <div className="flow-actions review-actions">
      <Button variant="secondary" size="small" className="compact" disabled={!canReview} onClick={() => onDecide("Changes requested")}>Request changes</Button>
      <Button variant="primary" size="small" className="compact" disabled={!canReview} onClick={() => onDecide("Approved")}><CheckCircle2 size={14} /> Approve revision</Button>
    </div>
  </div>;
}
