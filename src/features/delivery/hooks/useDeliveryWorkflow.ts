import { useEffect, useMemo } from "react";
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
  const [storedChange, setChange] = usePersistentState<PersistedChange>("agentforge:delivery:change", initialChange);
  const [revisions, setRevisions] = usePersistentState("agentforge:delivery:revisions", initialRevisions);
  const [evaluations, setEvaluations] = usePersistentState<Evaluation[]>("agentforge:delivery:evaluations", initialEvaluations);
  const [reviews, setReviews] = usePersistentState<Review[]>("agentforge:delivery:reviews", initialReviews);
  const [trailDone, setTrailDone] = usePersistentState("agentforge:delivery:trail-done", false);
  const [stackBase, setStackBase] = usePersistentState("agentforge:delivery:stack-base", "main");
  const [repairCount, setRepairCount] = usePersistentState("agentforge:delivery:repair-count", 0);
  const [title, setTitle] = usePersistentState("agentforge:delivery:title", initialChange.title);
  const [events, setEvents] = usePersistentState<string[]>("agentforge:delivery:events", ["CS-2481 r3 created from main", "EVL-5509 passed 38 checks"]);

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
  const stageState = useMemo(() => [
    change.status === "Draft" ? "In progress" : change.status,
    evidenceCurrent ? (latestEvaluation?.status === "Passed" ? "Passed" : "Failed") : "Stale",
    reviewCurrent ? latestReview?.decision ?? "Not reviewed" : "Not reviewed",
    trailDone ? "Completed" : "In progress",
  ], [change, latestEvaluation, evidenceCurrent, latestReview, reviewCurrent, trailDone]);

  const record = (message: string) => {
    setEvents((previous) => [message, ...previous].slice(0, 8));
    onNotify(message);
  };

  const createRevision = () => {
    const result = createNextRevision(change, migration.revisions, reviews);
    if (!result) {
      record("Revision blocked: merged changesets cannot be changed or revision number is unavailable");
      return;
    }
    setChange(result.change);
    setRevisions(result.revisions);
    setReviews(result.reviews);
    setTrailDone(false);
    record("Created " + change.id + " r" + result.revision.number + "; previous evidence is now stale");
  };

  const runEvaluation = () => {
    const outcome = repairCount < 1 || currentRevision.number > 3 ? "Passed" : "Failed";
    const evaluation = createEvaluation(change, currentRevision, evaluations, outcome);
    if (!evaluation) {
      record("Evaluation blocked: changeset is merged or revision is not current");
      return;
    }
    setEvaluations([evaluation, ...evaluations]);
    setChange({ ...change, status: evaluation.status === "Passed" ? "Ready for review" : "Evaluating" });
    record(evaluation.id + " " + evaluation.status.toLowerCase() + " on " + change.id + " r" + currentRevision.number);
  };

  const decide = (decision: "Approved" | "Changes requested") => {
    if (!canApproveRevision(currentRevisionId, latestEvaluation)) {
      record("Review blocked: current passing evidence is required");
      return;
    }
    const review = createReviewDecision(change, currentRevision, reviews, latestEvaluation, decision);
    if (!review) {
      record("Review blocked: decision does not target the active revision");
      return;
    }
    setReviews([review, ...reviews]);
    setChange({ ...change, status: decision === "Approved" ? "Approved" : "Changes requested" });
    record(decision + " " + change.id + " r" + currentRevision.number);
  };

  const merge = () => {
    const mergedChange = mergeChangeset(change, currentRevisionId, latestEvaluation, latestReview);
    if (!mergedChange) {
      record("Merge blocked: current passing evidence and approval are required");
      return;
    }
    setChange(mergedChange);
    setTrailDone(true);
    record(change.id + " r" + currentRevision.number + " merged; Trail TRL-042 completed (demo)");
  };

  const repair = () => {
    if (!canEditChangeset(change.status)) {
      record("Self-healing blocked: merged changesets cannot be changed");
      return;
    }
    setRepairCount(repairCount + 1);
    createRevision();
    record("Self-healing prepared a new revision; run Eval again (demo)");
  };

  const restack = () => {
    if (!canEditChangeset(change.status)) {
      record("Restack blocked: merged changesets cannot be changed");
      return;
    }
    setStackBase("main@" + (Date.now() % 10000));
    record("Stack restacked against the latest base (demo)");
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
