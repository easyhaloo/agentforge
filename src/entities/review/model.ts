export type ReviewDecision = "Pending" | "Approved" | "Changes requested";
export type RevisionReview = { id: string; revisionId: string; decision: ReviewDecision };
