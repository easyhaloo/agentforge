import {
  canApproveRevision,
  canCreateRevision,
  canRunEvaluation,
  revisionKey,
} from "../../domain/delivery";
import type { Revision } from "../../entities";
import type { Change, Evaluation, Review } from "./model";

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
    id: "REV-" + (891 + number),
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

export function createEvaluation(
  change: Change,
  revision: Revision,
  evaluations: Evaluation[],
  status: Evaluation["status"],
): Evaluation | null {
  if (!canRunEvaluation(change)
    || revision.changesetId !== change.id
    || revision.number !== change.revision
    || revision.id !== revisionKey(change.id, change.revision)) {
    return null;
  }

  return {
    id: "EVL-" + (5510 + evaluations.length),
    revision: revision.number,
    revisionId: revision.id,
    status,
    checks: 38,
    createdAt: "Just now",
  };
}

export function createReviewDecision(
  change: Change,
  revision: Revision,
  reviews: Review[],
  evidence: Evaluation | undefined,
  decision: "Approved" | "Changes requested",
): Review | null {
  if (revision.changesetId !== change.id
    || revision.number !== change.revision
    || revision.id !== revisionKey(change.id, change.revision)
    || !canApproveRevision(revision.id, evidence)) {
    return null;
  }

  return {
    id: "REV-" + (892 + reviews.length),
    revision: revision.number,
    revisionId: revision.id,
    decision,
    reviewer: "You",
  };
}
