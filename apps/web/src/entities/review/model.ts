import type { ReviewId, RevisionId } from "../identity";

export type ReviewDecision = "Pending" | "Approved" | "Changes requested";

export type RevisionReview = {
  id: ReviewId;
  revisionId: RevisionId;
  decision: ReviewDecision;
  reviewer: string;
};
