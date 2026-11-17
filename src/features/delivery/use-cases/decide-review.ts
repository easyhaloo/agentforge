import { canApproveRevision, revisionKey } from "../../../domain/delivery";
import { reviewId } from "../../../entities";
import type { Revision } from "../../../entities";
import type { Change, Evaluation, Review } from "../model";

export function createReviewDecision(
  change: Change,
  revision: Revision,
  reviews: Review[],
  evidence: Evaluation | undefined,
  decision: "Approved" | "Changes requested",
): Review | null {
  if (revision.changesetId !== change.id
    || revision.number !== change.revision
    || revision.id !== revisionKey(change.id, change.revision)
    || !canApproveRevision(revision.id, evidence)) {
    return null;
  }

  return {
    id: reviewId("REV-" + (892 + reviews.length)),
    revisionId: revision.id,
    decision,
    reviewer: "You",
  };
}
