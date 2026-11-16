export type GitCommit = { sha: string; repositoryId: string };
export type Changeset = { id: string; repositoryId: string; title: string; status: string };
export type Revision = { id: string; changesetId: string; number: number; baseCommitSha: string; headCommitSha: string };
export type RevisionEvidence = { revisionId: string; status: "Passed" | "Failed"; id: string };
export type RevisionReview = { revisionId: string; decision: "Pending" | "Approved" | "Changes requested"; id: string };

export const revisionKey = (changesetId: string, revision: number): string => `${changesetId}@r${revision}`;

export function isEvidenceCurrent(revisionId: string, evidence?: RevisionEvidence): boolean {
  return evidence?.revisionId === revisionId;
}

export function canApproveRevision(revisionId: string, evidence?: RevisionEvidence): boolean {
  return isEvidenceCurrent(revisionId, evidence) && evidence?.status === "Passed";
}

export function canMergeRevision(revisionId: string, evidence?: RevisionEvidence, review?: RevisionReview): boolean {
  return canApproveRevision(revisionId, evidence) && review?.revisionId === revisionId && review.decision === "Approved";
}
