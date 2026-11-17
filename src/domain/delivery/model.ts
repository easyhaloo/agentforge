import type { RevisionEvidence, RevisionReview } from "../../entities";

export type GitCommit = { sha: string; repositoryId: string };

export const revisionKey = (changesetId: string, revision: number): string => `${changesetId}@r${revision}`;

export function isEvidenceCurrent(revisionId: string, evidence?: RevisionEvidence): boolean {
  return evidence?.revisionId === revisionId;
}

export function canApproveRevision(revisionId: string, evidence?: RevisionEvidence): boolean {
  return isEvidenceCurrent(revisionId, evidence) && evidence?.status === "Passed";
}

export function canMergeRevision(revisionId: string, evidence?: RevisionEvidence, review?: RevisionReview): boolean {
  return canApproveRevision(revisionId, evidence)
    && review?.revisionId === revisionId
    && review.decision === "Approved";
}
