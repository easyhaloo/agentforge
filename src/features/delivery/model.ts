import type { Changeset, RevisionEvidence, RevisionReview } from "../../entities";

export type Evaluation = RevisionEvidence & { revision: number; checks: number; createdAt: string };
export type Review = RevisionReview & { revision: number; reviewer: string };
export type Change = Pick<Changeset, "id" | "title"> & {
  revision: number;
  base: string;
  status: Changeset["status"];
  files: number;
};

export const initialChange: Change = {
  id: "CS-2481", title: "Refactor auth token lifecycle", revision: 3,
  base: "main", status: "Draft", files: 12,
};
export const initialEvaluations: Evaluation[] = [{
  id: "EVL-5509", revision: 3, revisionId: "CS-2481@r3",
  status: "Passed", checks: 38, createdAt: "Today, 10:42",
}];
export const initialReviews: Review[] = [{
  id: "REV-891", revision: 3, revisionId: "CS-2481@r3",
  decision: "Pending", reviewer: "Mina",
}];
export const stages = [
  { id: "Changesets", label: "Changeset", desc: "Revisioned change" },
  { id: "Eval", label: "Eval", desc: "Verification evidence" },
  { id: "Review", label: "Review", desc: "Human decision" },
  { id: "Trails", label: "Trail", desc: "Delivery outcome" },
];
