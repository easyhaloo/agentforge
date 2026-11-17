import type { Changeset, ChangesetStatus, RevisionEvidence, RevisionReview } from "../../entities";

export type GitCommit = { sha: string; repositoryId: string };

export const revisionKey = (changesetId: string, revision: number): string => `${changesetId}@r${revision}`;

export function canEditChangeset(status: ChangesetStatus): boolean {
  return status !== "Merged";
}

export function canCreateRevision(changeset: Pick<Changeset, "status">): boolean {
  return canEditChangeset(changeset.status);
}

export function canRunEvaluation(changeset: Pick<Changeset, "status">): boolean {
  return canEditChangeset(changeset.status);
}

export function isEvidenceCurrent(revisionId: string, evidence?: RevisionEvidence): boolean {
  return evidence?.revisionId === revisionId;
}

export function isReviewCurrent(revisionId: string, review?: RevisionReview): boolean {
  return review?.revisionId === revisionId;
}

export function canApproveRevision(revisionId: string, evidence?: RevisionEvidence): boolean {
  return isEvidenceCurrent(revisionId, evidence) && evidence?.status === "Passed";
}

export function canMergeRevision(
  changeset: Pick<Changeset, "status">,
  revisionId: string,
  evidence?: RevisionEvidence,
  review?: RevisionReview,
): boolean {
  return changeset.status !== "Merged"
    && canApproveRevision(revisionId, evidence)
    && isReviewCurrent(revisionId, review)
    && review?.decision === "Approved";
}
