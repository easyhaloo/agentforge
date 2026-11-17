import { canMergeRevision } from "../../../domain/delivery";
import type { RevisionId } from "../../../entities";
import type { Change, Evaluation, Review } from "../model";

export function mergeChangeset(
  change: Change,
  revisionId: RevisionId,
  evidence: Evaluation | undefined,
  review: Review | undefined,
): Change | null {
  if (!canMergeRevision(change, revisionId, evidence, review)) return null;
  return { ...change, status: "Merged" };
}
