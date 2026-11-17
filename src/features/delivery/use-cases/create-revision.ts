import {
  canCreateRevision,
  reviewId,
  revisionKey,
} from "../../../domain/delivery";
import { type Revision, type RevisionId } from "../../../entities";
import { reviewId as createReviewId } from "../../../entities";
import type { Change, Review } from "../model";

export function resolveCurrentRevision(change: Change, revisions: Revision[]): Revision {
  return revisions.find((revision) => revision.changesetId === change.id && revision.number === change.revision)
    ?? {
      id: revisionKey(change.id, change.revision),
      changesetId: change.id,
      number: change.revision,
      baseCommitSha: null,
      headCommitSha: null,
      createdAt: "Existing local revision",
    };
}

export function createNextRevision(
  change: Change,
  revisions: Revision[],
  reviews: Review[],
): { change: Change; revision: Revision; revisions: Revision[]; reviews: Review[] } | null {
  if (!canCreateRevision(change)) return null;

  const currentRevision = resolveCurrentRevision(change, revisions);
  const number = change.revision + 1;
  const revision: Revision = {
    id: revisionKey(change.id, number),
    changesetId: change.id,
    number,
    baseCommitSha: null,
    headCommitSha: null,
    createdAt: "Just now",
  };
  const nextReview: Review = {
    id: createReviewId("REV-" + (891 + number)),
    revision: number,
    revisionId: revision.id,
    decision: "Pending",
    reviewer: "Mina",
  };
  const revisionHistory = revisions.some((item) => item.id === currentRevision.id)
    ? revisions
    : [...revisions, currentRevision];

  return {
    change: { ...change, revision: number, status: "Draft" },
    revision,
    revisions: [...revisionHistory, revision],
    reviews: [nextReview, ...reviews],
  };
}
