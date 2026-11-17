import {
  changesetId,
  evidenceId,
  reviewId,
  revisionId,
  type Changeset,
  type Revision,
  type RevisionEvidence,
  type RevisionReview,
} from "../../entities";

export type Evaluation = RevisionEvidence;
export type Review = RevisionReview;
export type EvaluationView = Evaluation & { revisionNumber: number | null };
export type ReviewView = Review & { revisionNumber: number | null };

export function selectEvaluationViews(
  evaluations: Evaluation[],
  revisions: Revision[],
): EvaluationView[] {
  const revisionNumbers = new Map(revisions.map((revision) => [revision.id, revision.number]));
  return evaluations.map((evaluation) => ({
    ...evaluation,
    revisionNumber: revisionNumbers.get(evaluation.revisionId) ?? null,
  }));
}

export function selectReviewViews(reviews: Review[], revisions: Revision[]): ReviewView[] {
  const revisionNumbers = new Map(revisions.map((revision) => [revision.id, revision.number]));
  return reviews.map((review) => ({
    ...review,
    revisionNumber: revisionNumbers.get(review.revisionId) ?? null,
  }));
}

export type Change = Pick<Changeset, "id" | "repositoryId" | "title" | "status"> & {
  revision: number;
  base: string;
  files: number;
};

export const initialChange: Change = {
  id: changesetId("CS-2481"),
  repositoryId: "repo-agentforge",
  title: "Refactor auth token lifecycle",
  revision: 3,
  base: "main",
  status: "Draft",
  files: 12,
};

export const initialRevisions: Revision[] = [{
  id: revisionId("CS-2481@r3"),
  changesetId: initialChange.id,
  number: 3,
  baseCommitSha: null,
  headCommitSha: null,
  createdAt: "Today, 10:30",
}];

export const initialEvaluations: Evaluation[] = [{
  id: evidenceId("EVL-5509"),
  revisionId: initialRevisions[0].id,
  status: "Passed",
  checks: 38,
  createdAt: "Today, 10:42",
}];

export const initialReviews: Review[] = [{
  id: reviewId("REV-891"),
  revisionId: initialRevisions[0].id,
  decision: "Pending",
  reviewer: "Mina",
}];

export const stages = [
  { id: "Changesets", label: "Changeset", desc: "Revisioned change" },
  { id: "Eval", label: "Eval", desc: "Verification evidence" },
  { id: "Review", label: "Review", desc: "Human decision" },
  { id: "Trails", label: "Trail", desc: "Delivery outcome" },
];
