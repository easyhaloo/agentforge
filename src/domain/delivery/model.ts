import type { Changeset, ChangesetId, ChangesetStatus, GitCommitSha, RevisionEvidence, RevisionId, RevisionReview } from "../../entities";
import { revisionId } from "../../entities";

export type GitCommit = { sha: GitCommitSha; repositoryId: string };

export const revisionKey = (changesetId: ChangesetId, revision: number): RevisionId =>
  revisionId(`${changesetId}@r${revision}`);

export function canEditChangeset(status: ChangesetStatus): boolean {
  return status !== "Merged";
}

export function canCreateRevision(changeset: Pick<Changeset, "status">): boolean {
  return canEditChangeset(changeset.status);
}

export function canRunEvaluation(changeset: Pick<Changeset, "status">): boolean {
  return canEditChangeset(changeset.status);
}

export function isEvidenceCurrent(revisionId: RevisionId, evidence?: RevisionEvidence): boolean {
  return evidence?.revisionId === revisionId;
}

export function isReviewCurrent(revisionId: RevisionId, review?: RevisionReview): boolean {
  return review?.revisionId === revisionId;
}

export function canApproveRevision(revisionId: RevisionId, evidence?: RevisionEvidence): boolean {
  return isEvidenceCurrent(revisionId, evidence) && evidence?.status === "Passed";
}

export function canMergeRevision(
  changeset: Pick<Changeset, "status">,
  revisionId: RevisionId,
  evidence?: RevisionEvidence,
  review?: RevisionReview,
): boolean {
  return changeset.status !== "Merged"
    && canApproveRevision(revisionId, evidence)
    && isReviewCurrent(revisionId, review)
    && review?.decision === "Approved";
}
