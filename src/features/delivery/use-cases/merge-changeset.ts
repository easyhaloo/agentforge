import { canMergeRevision } from "../../../domain/delivery";
import type { Change, Evaluation, Review } from "../model";

export function mergeChangeset(
  change: Change,
  revisionId: string,
  evidence: Evaluation | undefined,
  review: Review | undefined,
): Change | null {
  if (!canMergeRevision(change, revisionId, evidence, review)) return null;
  return { ...change, status: "Merged" };
}
