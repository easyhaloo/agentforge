export type Evaluation = { id: string; revision: number; revisionId: string; status: "Passed" | "Failed"; checks: number; createdAt: string };
export type Review = { id: string; revision: number; revisionId: string; decision: "Pending" | "Approved" | "Changes requested"; reviewer: string };
export type Change = { id: string; title: string; revision: number; base: string; status: "Draft" | "Evaluating" | "Ready for review" | "Changes requested" | "Approved" | "Merged"; files: number; };
export const initialChange: Change = { id:"CS-2481", title:"Refactor auth token lifecycle", revision:3, base:"main", status:"Draft", files:12 };
export const initialEvaluations: Evaluation[] = [{id:"EVL-5509",revision:3,revisionId:"CS-2481@r3",status:"Passed",checks:38,createdAt:"Today, 10:42"}];
export const initialReviews: Review[] = [{id:"REV-891",revision:3,revisionId:"CS-2481@r3",decision:"Pending",reviewer:"Mina"}];

export const stages = [
  {id:"Changesets",label:"Changeset",desc:"Revisioned change"},
  {id:"Eval",label:"Eval",desc:"Verification evidence"},
  {id:"Review",label:"Review",desc:"Human decision"},
  {id:"Trails",label:"Trail",desc:"Delivery outcome"}
];