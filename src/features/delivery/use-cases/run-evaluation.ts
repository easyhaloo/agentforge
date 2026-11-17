import { canRunEvaluation, evidenceId, revisionKey } from "../../../domain/delivery";
import type { Revision } from "../../../entities";
import type { Change, Evaluation } from "../model";

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
    id: evidenceId("EVL-" + (5510 + evaluations.length)),
    revision: revision.number,
    revisionId: revision.id,
    status,
    checks: 38,
    createdAt: "Just now",
  };
}
