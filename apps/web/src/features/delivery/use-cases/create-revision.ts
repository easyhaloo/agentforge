import { canCreateRevision, isRevisionNumberAvailable, revisionKey } from "../../../domain/delivery";
import { reviewId, type Revision } from "../../../entities";
import type { Change, Review } from "../model";

export function resolveCurrentRevision(change: Change, revisions: Revision[]): Revision {
  const existing = revisions.find((revision) =>
    revision.id === change.currentRevisionId && revision.changesetId === change.id,
  );
  if (existing) return existing;

  const match = /^.+@r([1-9]\d*)$/.exec(change.currentRevisionId);
  const number = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(number) || number < 1 || revisionKey(change.id, number) !== change.currentRevisionId) {
    throw new Error("Changeset currentRevisionId does not identify a valid revision");
  }

  return {
    id: change.currentRevisionId,
    changesetId: change.id,
    number,
    baseCommitSha: null,
    headCommitSha: null,
    createdAt: "Restored from local state",
  };
}

export function createNextRevision(
  change: Change,
  revisions: Revision[],
  reviews: Review[],
): { change: Change; revision: Revision; revisions: Revision[]; reviews: Review[] } | null {
  if (!canCreateRevision(change)) return null;

  const currentRevision = resolveCurrentRevision(change, revisions);
  const number = currentRevision.number + 1;
  if (!isRevisionNumberAvailable(change.id, revisions, number)) return null;

  const revision: Revision = {
    id: revisionKey(change.id, number),
    changesetId: change.id,
    number,
    baseCommitSha: null,
    headCommitSha: null,
    createdAt: "Just now",
  };
  const nextReview: Review = {
    id: reviewId("REV-" + (891 + number)),
    revisionId: revision.id,
    decision: "Pending",
    reviewer: "Mina",
  };
  const revisionHistory = revisions.some((item) => item.id === currentRevision.id)
    ? revisions
    : [...revisions, currentRevision];

  return {
    change: { ...change, currentRevisionId: revision.id, status: "Draft" },
    revision,
    revisions: [...revisionHistory, revision],
    reviews: [nextReview, ...reviews],
  };
}
