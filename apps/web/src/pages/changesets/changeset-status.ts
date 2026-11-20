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

/**
 * The audit operations the delivery API records, in the order the flow produces them.
 *
 * The codes are the server's own (see `internal/delivery/changeset.go`); only the wording belongs
 * to the interface, so every operation is looked up in the translation of the language the reader
 * chose.
 */
export const changesetAuditOperations = [
  "changeset.created",
  "revision.created",
  "evaluation.recorded",
  "evidence.attached",
  "review.assigned",
  "review.decided",
  "review.superseded",
  "merge.completed",
] as const;

/** The outcomes an audit entry can carry. */
export const changesetAuditOutcomes = ["succeeded", "pending", "approved", "rejected", "stale"] as const;

/**
 * The label an audit operation is shown with.
 *
 * An operation the interface does not know is shown as the server spelled it, so a new server
 * operation never reads as a missing translation.
 */
export function auditOperationLabel(operation: string, t: TFunction): string {
  if (!changesetAuditOperations.includes(operation as (typeof changesetAuditOperations)[number])) return operation;
  // i18next reads "." as a path separator, so the server's dotted code becomes an underscored key.
  return t(`changesets:audit.operations.${operation.replace(".", "_")}`);
}

/** The label an audit outcome is shown with. */
export function auditOutcomeLabel(outcome: string, t: TFunction): string {
  if (!changesetAuditOutcomes.includes(outcome as (typeof changesetAuditOutcomes)[number])) return outcome;
  return t(`changesets:audit.outcomes.${outcome}`);
}

/**
 * The label an audit entry is shown with: the operation, and the outcome when it adds something.
 *
 * "succeeded" is the outcome of an operation that simply happened, so it is left out. The outcome
 * is what tells a granted review from a rejected one, and a superseded review from a pending one.
 */
export function auditEntryLabel(operation: string, outcome: string, t: TFunction): string {
  const label = auditOperationLabel(operation, t);
  if (outcome === "" || outcome === "succeeded") return label;
  return `${label} · ${auditOutcomeLabel(outcome, t)}`;
}
