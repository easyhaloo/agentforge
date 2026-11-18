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
