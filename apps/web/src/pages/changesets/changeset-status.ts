import type { ChangesetStatus } from "../../shared/api/identity";

/** The labels the server's status codes are shown with. */
export const changesetStatusLabels: Record<ChangesetStatus, string> = {
  draft: "Draft",
  evaluation_pending: "Evaluation pending",
  evaluation_failed: "Evaluation failed",
  evidence_required: "Evidence required",
  review_required: "Review required",
  in_review: "In review",
  changes_requested: "Changes requested",
  ready_to_merge: "Ready to merge",
  merged: "Merged",
};

/** Merged and ready to merge read as success, failures and change requests as danger, the rest as muted. */
export function changesetStatusClass(status: string): string {
  if (status === "Merged" || status === "Ready to merge") return "status success";
  if (status === "Evaluation failed" || status === "Changes requested") return "status danger";
  return "status muted";
}

/** The lifecycle steps the detail page shows, in order. */
export const changesetLifecycleSteps = ["Repository", "Revision", "Evaluation", "Evidence", "Review", "Merge"] as const;

/** How many lifecycle steps the server's status says are behind the changeset. */
const lifecycleStepsCompleted: Record<ChangesetStatus, number> = {
  draft: 0,
  evaluation_pending: 1,
  evaluation_failed: 1,
  evidence_required: 2,
  review_required: 3,
  in_review: 3,
  changes_requested: 3,
  ready_to_merge: 4,
  merged: 5,
};

/** The steps the server's status says are done; the next one is where the changeset is. */
export function completedLifecycleSteps(status: ChangesetStatus): number {
  return lifecycleStepsCompleted[status];
}
