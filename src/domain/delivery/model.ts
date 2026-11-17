import type { Changeset, ChangesetId, ChangesetStatus, GitCommitSha, Revision, RevisionEvidence, RevisionId, RevisionReview } from "../../entities";
import { revisionId } from "../../entities";

export type GitCommit = { sha: GitCommitSha; repositoryId: string };

export const revisionKey = (changesetId: ChangesetId, revision: number): RevisionId => {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("Revision number must be a positive safe integer");
  }
  return revisionId(`${changesetId}@r${revision}`);
};

export function isRevisionNumberAvailable(
  changesetId: ChangesetId,
  revisions: Revision[],
  candidateNumber: number,
): boolean {
  return Number.isSafeInteger(candidateNumber)
    && candidateNumber > 0
    && !revisions.some((revision) => revision.changesetId === changesetId && revision.number === candidateNumber);
}

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
  changeset: Pick<Changeset, "status" | "currentRevisionId">,
  revisionId: RevisionId,
  evidence?: RevisionEvidence,
  review?: RevisionReview,
): boolean {
  return changeset.status !== "Merged"
    && changeset.currentRevisionId === revisionId
    && canApproveRevision(revisionId, evidence)
    && isReviewCurrent(revisionId, review)
    && review?.decision === "Approved";
}
