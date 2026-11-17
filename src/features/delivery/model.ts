import {
  changesetId,
  evidenceId,
  gitCommitSha,
  reviewId,
  revisionId,
  type Changeset,
  type Revision,
  type RevisionEvidence,
  type RevisionReview,
} from "../../entities";

export type Evaluation = RevisionEvidence;
export type Review = RevisionReview;
export type EvaluationView = Evaluation & { revisionNumber: number | null };
export type ReviewView = Review & { revisionNumber: number | null };

export function selectEvaluationViews(
  evaluations: Evaluation[],
  revisions: Revision[],
): EvaluationView[] {
  const revisionNumbers = new Map(revisions.map((revision) => [revision.id, revision.number]));
  return evaluations.map((evaluation) => ({
    ...evaluation,
    revisionNumber: revisionNumbers.get(evaluation.revisionId) ?? null,
  }));
}

export function selectReviewViews(reviews: Review[], revisions: Revision[]): ReviewView[] {
  const revisionNumbers = new Map(revisions.map((revision) => [revision.id, revision.number]));
  return reviews.map((review) => ({
    ...review,
    revisionNumber: revisionNumbers.get(review.revisionId) ?? null,
  }));
}

export type Change = Pick<Changeset, "id" | "repositoryId" | "title" | "status" | "currentRevisionId"> & {
  base: string;
  files: number;
};

export type PersistedChange = Change | (Omit<Change, "currentRevisionId"> & { revision: number });

export type ChangeMigration = {
  change: Change;
  revisions: Revision[];
  migrated: boolean;
};

export const initialRevisions: Revision[] = [{
  id: revisionId("CS-2481@r3"),
  changesetId: changesetId("CS-2481"),
  number: 3,
  baseCommitSha: null,
  headCommitSha: null,
  createdAt: "Today, 10:30",
}];

export const initialChange: Change = {
  id: changesetId("CS-2481"),
  repositoryId: "repo-agentforge",
  title: "Refactor auth token lifecycle",
  currentRevisionId: initialRevisions[0].id,
  base: "main",
  status: "Draft",
  files: 12,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function revisionNumberFromId(value: string): number | null {
  const match = /^.+@r([1-9]\d*)$/.exec(value);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? number : null;
}

function normalizeRevisions(value: unknown): { revisions: Revision[]; changed: boolean } {
  if (!Array.isArray(value)) return { revisions: initialRevisions, changed: true };
  const revisions = value.flatMap((item): Revision[] => {
    if (!isRecord(item)
      || typeof item.id !== "string"
      || typeof item.changesetId !== "string"
      || typeof item.number !== "number"
      || !Number.isSafeInteger(item.number)
      || item.number < 1
      || typeof item.createdAt !== "string"
      || (item.baseCommitSha !== null && typeof item.baseCommitSha !== "string")
      || (item.headCommitSha !== null && typeof item.headCommitSha !== "string")) return [];
    try {
      return [{
        id: revisionId(item.id),
        changesetId: changesetId(item.changesetId),
        number: item.number,
        baseCommitSha: item.baseCommitSha === null ? null : gitCommitSha(item.baseCommitSha),
        headCommitSha: item.headCommitSha === null ? null : gitCommitSha(item.headCommitSha),
        createdAt: item.createdAt,
      }];
    } catch {
      return [];
    }
  });
  return { revisions, changed: revisions.length !== value.length };
}

/** Converts the previous revision-number-based local state to the ID-based model. */
export function migrateChangeState(
  value: unknown,
  storedRevisionsValue: unknown,
): ChangeMigration {
  const normalized = normalizeRevisions(storedRevisionsValue);
  const storedRevisions = normalized.revisions;
  if (!isRecord(value)
    || typeof value.id !== "string"
    || value.id.trim().length === 0
    || typeof value.repositoryId !== "string"
    || typeof value.title !== "string"
    || typeof value.base !== "string"
    || typeof value.files !== "number"
    || !Number.isFinite(value.files)
    || !["Draft", "Evaluating", "Ready for review", "Changes requested", "Approved", "Merged"].includes(String(value.status))) {
    return { change: initialChange, revisions: storedRevisions, migrated: true };
  }

  const id = changesetId(value.id);
  const status = value.status as Change["status"];
  const requestedRevisionId = typeof value.currentRevisionId === "string" && value.currentRevisionId.trim().length > 0
    ? revisionId(value.currentRevisionId)
    : null;
  const revisionNumber = typeof value.revision === "number"
    && Number.isSafeInteger(value.revision)
    && value.revision > 0
    ? value.revision
    : requestedRevisionId
      ? revisionNumberFromId(requestedRevisionId)
      : null;
  const existingRevision = requestedRevisionId
    ? storedRevisions.find((revision) => revision.id === requestedRevisionId && revision.changesetId === id)
    : undefined;
  const legacyRevision = revisionNumber === null
    ? undefined
    : storedRevisions.find((revision) => revision.changesetId === id && revision.number === revisionNumber);
  const activeRevision = existingRevision ?? legacyRevision ?? (revisionNumber === null ? undefined : {
    id: revisionId(`${id}@r${revisionNumber}`),
    changesetId: id,
    number: revisionNumber,
    baseCommitSha: null,
    headCommitSha: null,
    createdAt: "Restored from local state",
  });

  if (!activeRevision) {
    return { change: initialChange, revisions: storedRevisions, migrated: true };
  }

  const change: Change = {
    id,
    repositoryId: value.repositoryId,
    title: value.title,
    status,
    currentRevisionId: activeRevision.id,
    base: value.base,
    files: value.files,
  };
  const revisions = storedRevisions.some((revision) => revision.id === activeRevision.id)
    ? storedRevisions
    : [...storedRevisions, activeRevision];
  const migrated = normalized.changed
    || !("currentRevisionId" in value)
    || value.currentRevisionId !== activeRevision.id
    || "revision" in value
    || revisions !== storedRevisions;

  return { change, revisions, migrated };
}
 
export const initialEvaluations: Evaluation[] = [{
  id: evidenceId("EVL-5509"),
  revisionId: initialRevisions[0].id,
  status: "Passed",
  checks: 38,
  createdAt: "Today, 10:42",
}];

export const initialReviews: Review[] = [{
  id: reviewId("REV-891"),
  revisionId: initialRevisions[0].id,
  decision: "Pending",
  reviewer: "Mina",
}];

export const stages = [
  { id: "Changesets", label: "Changeset", desc: "Revisioned change" },
  { id: "Eval", label: "Eval", desc: "Verification evidence" },
  { id: "Review", label: "Review", desc: "Human decision" },
  { id: "Trails", label: "Trail", desc: "Delivery outcome" },
];
