import type { TFunction } from "i18next";
import type { ChangesetStatus } from "../../shared/api/identity";

/**
 * The labels the server's status codes are shown with.
 *
 * The status codes are the server's own (ADR-003); only the wording belongs to the interface,
 * so every label is looked up in the translation of the language the reader chose.
 */

/** The label the server's changeset status is shown with. */
export function changesetStatusLabel(status: ChangesetStatus, t: TFunction): string {
  return t(`changesets:status.${status}`);
}

/** Merged and ready to merge read as success, failures and change requests as danger, the rest as muted. */
export function changesetStatusClass(status: ChangesetStatus): string {
  if (status === "merged" || status === "ready_to_merge") return "status success";
  if (status === "evaluation_failed" || status === "changes_requested") return "status danger";
  return "status muted";
}

/** The translation key of each review status the server reports. */
const reviewStatusKeyByStatus: Record<string, string> = {
  pending: "changesets:reviewStatus.pending",
  approved: "changesets:reviewStatus.approved",
  rejected: "changesets:reviewStatus.rejected",
  stale: "changesets:reviewStatus.stale",
};

/**
 * The label a review status is shown with.
 *
 * A status the interface does not know is shown as the server spelled it, so a new server status
 * never reads as a missing translation.
 */
export function reviewStatusLabel(status: string, t: TFunction): string {
  const key = reviewStatusKeyByStatus[status];
  return key ? t(key) : status;
}

/** The lifecycle steps the detail page shows, in order. */
export const changesetLifecycleSteps = ["repository", "revision", "evaluation", "evidence", "review", "merge"] as const;

/** The label a lifecycle step is shown with. */
export function changesetLifecycleStepLabel(step: (typeof changesetLifecycleSteps)[number], t: TFunction): string {
  return t(`changesets:lifecycle.${step}`);
}

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

/**
 * Why the server refuses a new review for a changeset in this status. The wording is the server's own:
 * it answers 409 "Review already approved" once the current revision carries an approved review.
 */
export function changesetReviewRefusal(status: ChangesetStatus, t: TFunction): string {
  if (status === "ready_to_merge") return t("changesets:reviewRefusal.readyToMerge");
  if (status === "merged") return t("changesets:reviewRefusal.merged");
  return t("changesets:reviewRefusal.default");
}
