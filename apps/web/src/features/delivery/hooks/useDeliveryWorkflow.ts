import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { canApproveRevision, canEditChangeset, isEvidenceCurrent, isReviewCurrent } from "../../../domain/delivery";
import { usePersistentState } from "../../../shared/hooks/usePersistentState";
import {
  initialChange, initialEvaluations, initialRevisions, initialReviews, migrateChangeState,
  selectEvaluationViews, selectReviewViews,
  type Change, type Evaluation, type PersistedChange, type Review,
} from "../model";
import {
  createEvaluation,
  createNextRevision,
  createReviewDecision,
  mergeChangeset,
  resolveCurrentRevision,
} from "../use-cases";

export function useDeliveryWorkflow(onNotify: (message: string) => void) {
  const { t } = useTranslation("common");
  const [storedChange, setChange] = usePersistentState<PersistedChange>("agentforge:delivery:change", initialChange);
  const [revisions, setRevisions] = usePersistentState("agentforge:delivery:revisions", initialRevisions);
  const [evaluations, setEvaluations] = usePersistentState<Evaluation[]>("agentforge:delivery:evaluations", initialEvaluations);
  const [reviews, setReviews] = usePersistentState<Review[]>("agentforge:delivery:reviews", initialReviews);
  const [trailDone, setTrailDone] = usePersistentState("agentforge:delivery:trail-done", false);
  const [stackBase, setStackBase] = usePersistentState("agentforge:delivery:stack-base", "main");
  const [repairCount, setRepairCount] = usePersistentState("agentforge:delivery:repair-count", 0);
  const [title, setTitle] = usePersistentState("agentforge:delivery:title", initialChange.title);

  // The audit trail starts with the two events the demo begins with, in the interface language.
  const seedEvents = useMemo(() => [
    t("delivery.events.seedRevision", { id: "CS-2481", revision: 3, base: "main" }),
    t("delivery.events.seedEvidence", { id: "EVL-5509", count: 38 }),
  ], [t]);
  const [events, setEvents] = usePersistentState<string[]>("agentforge:delivery:events", seedEvents);

  const migration = migrateChangeState(storedChange, revisions);
  const change = migration.change;
  useEffect(() => {
    if (!migration.migrated) return;
    setChange(migration.change);
    if (migration.revisions !== revisions) setRevisions(migration.revisions);
  }, [migration, revisions, setChange, setRevisions]);

  const currentRevision = resolveCurrentRevision(change, migration.revisions);
  const currentRevisionId = currentRevision.id;
  const latestEvaluation = evaluations[0];
  const latestReview = reviews[0];
  const evaluationViews = selectEvaluationViews(evaluations, migration.revisions);
  const reviewViews = selectReviewViews(reviews, migration.revisions);
  const evidenceCurrent = isEvidenceCurrent(currentRevisionId, latestEvaluation);
  const reviewCurrent = isReviewCurrent(currentRevisionId, latestReview);
  const approved = reviewCurrent && latestReview?.decision === "Approved";

  // The status the API reports and the wording the interface shows.
  const statusLabels = useMemo<Record<string, string>>(() => ({
    "Draft": t("delivery.status.draft"),
    "Evaluating": t("delivery.status.evaluating"),
    "Ready for review": t("delivery.status.readyForReview"),
    "Changes requested": t("delivery.status.changesRequested"),
    "Approved": t("delivery.status.approved"),
    "Merged": t("delivery.status.merged"),
  }), [t]);
  const decisionLabels = useMemo<Record<string, string>>(() => ({
    "Pending": t("delivery.review.pending"),
    "Approved": t("delivery.review.approved"),
    "Changes requested": t("delivery.review.changesRequested"),
  }), [t]);

  const stageState = useMemo(() => [
    change.status === "Draft" ? t("delivery.stageState.inProgress") : statusLabels[change.status],
    evidenceCurrent ? (latestEvaluation?.status === "Passed" ? t("delivery.stageState.passed") : t("delivery.stageState.failed")) : t("delivery.stageState.stale"),
    reviewCurrent ? (latestReview ? decisionLabels[latestReview.decision] : t("delivery.stageState.notReviewed")) : t("delivery.stageState.notReviewed"),
    trailDone ? t("delivery.stageState.completed") : t("delivery.stageState.inProgress"),
  ], [change, latestEvaluation, evidenceCurrent, latestReview, reviewCurrent, trailDone, statusLabels, decisionLabels, t]);

  const record = (message: string) => {
    setEvents((previous) => [message, ...previous].slice(0, 8));
    onNotify(message);
  };

  const createRevision = () => {
    const result = createNextRevision(change, migration.revisions, reviews);
    if (!result) {
      record(t("delivery.events.revisionBlocked"));
      return;
    }
    setChange(result.change);
    setRevisions(result.revisions);
    setReviews(result.reviews);
    setTrailDone(false);
    record(t("delivery.events.revisionCreated", { id: change.id, revision: result.revision.number }));
  };

  const runEvaluation = () => {
    const outcome = repairCount < 1 || currentRevision.number > 3 ? "Passed" : "Failed";
    const evaluation = createEvaluation(change, currentRevision, evaluations, outcome);
    if (!evaluation) {
      record(t("delivery.events.evaluationBlocked"));
      return;
    }
    setEvaluations([evaluation, ...evaluations]);
    setChange({ ...change, status: evaluation.status === "Passed" ? "Ready for review" : "Evaluating" });
    record(t("delivery.events.evaluationResult", {
      id: evaluation.id,
      status: evaluation.status === "Passed" ? t("delivery.evidence.passed") : t("delivery.evidence.failed"),
      changeset: change.id,
      revision: currentRevision.number,
    }));
  };

  const decide = (decision: "Approved" | "Changes requested") => {
    if (!canApproveRevision(currentRevisionId, latestEvaluation)) {
      record(t("delivery.events.reviewBlockedEvidence"));
      return;
    }
    const review = createReviewDecision(change, currentRevision, reviews, latestEvaluation, decision);
    if (!review) {
      record(t("delivery.events.reviewBlockedRevision"));
      return;
    }
    setReviews([review, ...reviews]);
    setChange({ ...change, status: decision === "Approved" ? "Approved" : "Changes requested" });
    record(t("delivery.events.reviewDecision", {
      decision: decisionLabels[decision],
      id: change.id,
      revision: currentRevision.number,
    }));
  };

  const merge = () => {
    const mergedChange = mergeChangeset(change, currentRevisionId, latestEvaluation, latestReview);
    if (!mergedChange) {
      record(t("delivery.events.mergeBlocked"));
      return;
    }
    setChange(mergedChange);
    setTrailDone(true);
    record(t("delivery.events.merged", { id: change.id, revision: currentRevision.number }));
  };

  const repair = () => {
    if (!canEditChangeset(change.status)) {
      record(t("delivery.events.selfHealingBlocked"));
      return;
    }
    setRepairCount(repairCount + 1);
    createRevision();
    record(t("delivery.events.selfHealingPrepared"));
  };

  const restack = () => {
    if (!canEditChangeset(change.status)) {
      record(t("delivery.events.restackBlocked"));
      return;
    }
    setStackBase("main@" + (Date.now() % 10000));
    record(t("delivery.events.restacked"));
  };

  const commitTitle = () => {
    if (!canEditChangeset(change.status)) return;
    setChange({ ...change, title });
  };

  return {
    change, title, evaluations, evaluationViews, reviews: reviewViews, currentRevisionId, currentRevisionNumber: currentRevision.number, evidenceCurrent,
    approved, trailDone, stackBase, events, stageState,
    setTitle, commitTitle, createRevision, runEvaluation, repair, restack, decide, merge,
  };
}
