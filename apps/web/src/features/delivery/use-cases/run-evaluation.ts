import { canRunEvaluation, revisionKey } from "../../../domain/delivery";
import { evidenceId, type Revision } from "../../../entities";
import type { Change, Evaluation } from "../model";

export function createEvaluation(
  change: Change,
  revision: Revision,
  evaluations: Evaluation[],
  status: Evaluation["status"],
): Evaluation | null {
  if (!canRunEvaluation(change)
    || revision.changesetId !== change.id
    || revision.id !== change.currentRevisionId
    || revision.id !== revisionKey(change.id, revision.number)) {
    return null;
  }

  return {
    id: evidenceId("EVL-" + (5510 + evaluations.length)),
    revisionId: revision.id,
    status,
    checks: 38,
    createdAt: new Date().toISOString(),
  };
}
