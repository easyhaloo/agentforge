import { CheckCircle2, GitPullRequest } from "lucide-react";
import { canApproveRevision } from "../../../domain/delivery";
import type { RevisionId } from "../../../entities";
import type { Evaluation, Review } from "../model";

type Props = {
  currentRevisionId: RevisionId;
  latestEvaluation: Evaluation | undefined;
  reviews: Review[];
  onDecide: (decision: "Approved" | "Changes requested") => void;
};

export function ReviewDecision({ currentRevisionId, latestEvaluation, reviews, onDecide }: Props) {
  const canReview = canApproveRevision(currentRevisionId, latestEvaluation);
  const latestReview = reviews[0];

  return <div className="flow-subsection">
    <div className="flow-subhead"><h4><GitPullRequest size={14} /> Review decision</h4><span>{latestReview?.decision ?? "Not requested"}</span></div>
    {reviews.slice(0, 3).map((review) => <div className="evidence-row" key={review.id}>
      <span className="evidence-icon review"><GitPullRequest size={13} /></span>
      <div><b>{review.id} · r{review.revision}</b><small>{review.reviewer} · revision-scoped review</small></div>
      <strong>{review.decision}</strong>
    </div>)}
    <div className="flow-actions review-actions">
      <button className="button secondary compact" disabled={!canReview} onClick={() => onDecide("Changes requested")}>Request changes</button>
      <button className="button primary compact" disabled={!canReview} onClick={() => onDecide("Approved")}><CheckCircle2 size={14} /> Approve revision</button>
    </div>
  </div>;
}
