import { revisionKey } from "../../domain/delivery";
import type { Change, Evaluation, Review } from "./model";

export function createNextRevision(change: Change, reviews: Review[]) {
  const revision = change.revision + 1;
  const nextChange: Change = { ...change, revision, status: "Draft" };
  const nextReview: Review = {
    id: "REV-" + (891 + revision),
    revision,
    revisionId: revisionKey(change.id, revision),
    decision: "Pending",
    reviewer: "Mina",
  };

  return { change: nextChange, reviews: [nextReview, ...reviews] };
}

export function createEvaluation(
  change: Change,
  evaluations: Evaluation[],
  repairCount: number,
): Evaluation {
  const passed = repairCount < 1 || change.revision > 3;
  return {
    id: "EVL-" + (5510 + evaluations.length),
    revision: change.revision,
    revisionId: revisionKey(change.id, change.revision),
    status: passed ? "Passed" : "Failed",
    checks: 38,
    createdAt: "Just now",
  };
}

export function createReviewDecision(
  change: Change,
  reviews: Review[],
  decision: "Approved" | "Changes requested",
): Review {
  return {
    id: "REV-" + (892 + reviews.length),
    revision: change.revision,
    revisionId: revisionKey(change.id, change.revision),
    decision,
    reviewer: "You",
  };
}
