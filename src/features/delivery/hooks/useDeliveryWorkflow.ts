import { useMemo } from "react";
import { canApproveRevision, canMergeRevision, isEvidenceCurrent, revisionKey } from "../../../domain/delivery";
import { usePersistentState } from "../../../shared/hooks/usePersistentState";
import { initialChange, initialEvaluations, initialReviews, type Change, type Evaluation, type Review } from "../model";
import { createEvaluation, createNextRevision, createReviewDecision } from "../workflow";

export function useDeliveryWorkflow(onNotify: (message: string) => void) {
  const [change, setChange] = usePersistentState<Change>("agentforge:delivery:change", initialChange);
  const [evaluations, setEvaluations] = usePersistentState<Evaluation[]>("agentforge:delivery:evaluations", initialEvaluations);
  const [reviews, setReviews] = usePersistentState<Review[]>("agentforge:delivery:reviews", initialReviews);
  const [trailDone, setTrailDone] = usePersistentState("agentforge:delivery:trail-done", false);
  const [stackBase, setStackBase] = usePersistentState("agentforge:delivery:stack-base", "main");
  const [repairCount, setRepairCount] = usePersistentState("agentforge:delivery:repair-count", 0);
  const [title, setTitle] = usePersistentState("agentforge:delivery:title", initialChange.title);
  const [events, setEvents] = usePersistentState<string[]>("agentforge:delivery:events", ["CS-2481 r3 created from main", "EVL-5509 passed 38 checks"]);

  const latestEvaluation = evaluations[0];
  const latestReview = reviews[0];
  const currentRevisionId = revisionKey(change.id, change.revision);
  const evidenceCurrent = isEvidenceCurrent(currentRevisionId, latestEvaluation);
  const approved = latestReview?.revisionId === currentRevisionId && latestReview.decision === "Approved";
  const stageState = useMemo(() => [
    change.status === "Draft" ? "In progress" : change.status,
    evidenceCurrent ? (latestEvaluation.status === "Passed" ? "Passed" : "Failed") : "Stale",
    latestReview?.revisionId === currentRevisionId ? latestReview.decision : "Not reviewed",
    trailDone ? "Completed" : "In progress",
  ], [change, latestEvaluation, evidenceCurrent, latestReview, currentRevisionId, trailDone]);

  const record = (message: string) => {
    setEvents((previous) => [message, ...previous].slice(0, 8));
    onNotify(message);
  };

  const createRevision = () => {
    const result = createNextRevision(change, reviews);
    setChange(result.change);
    setReviews(result.reviews);
    setTrailDone(false);
    record("Created " + change.id + " r" + result.change.revision + "; previous evidence is now stale");
  };

  const runEvaluation = () => {
    const evaluation = createEvaluation(change, evaluations, repairCount);
    setEvaluations([evaluation, ...evaluations]);
    setChange({ ...change, status: evaluation.status === "Passed" ? "Ready for review" : "Evaluating" });
    record(evaluation.id + " " + evaluation.status.toLowerCase() + " on " + change.id + " r" + change.revision);
  };

  const decide = (decision: "Approved" | "Changes requested") => {
    if (!canApproveRevision(currentRevisionId, latestEvaluation)) {
      record("Review blocked: current passing evidence is required");
      return;
    }
    const review = createReviewDecision(change, reviews, decision);
    setReviews([review, ...reviews]);
    setChange({ ...change, status: decision === "Approved" ? "Approved" : "Changes requested" });
    record(decision + " " + change.id + " r" + change.revision);
  };

  const merge = () => {
    if (!canMergeRevision(currentRevisionId, latestEvaluation, latestReview)) {
      record("Merge blocked: approval for the current revision is required");
      return;
    }
    setChange({ ...change, status: "Merged" });
    setTrailDone(true);
    record(change.id + " r" + change.revision + " merged; Trail TRL-042 completed");
  };

  const repair = () => {
    setRepairCount(repairCount + 1);
    createRevision();
    record("Self-healing prepared a new revision; run Eval again");
  };

  const restack = () => {
    setStackBase("main@" + (Date.now() % 10000));
    record("Stack restacked against the latest base (demo)");
  };

  const commitTitle = () => setChange({ ...change, title });

  return {
    change, title, evaluations, reviews, currentRevisionId, evidenceCurrent,
    approved, trailDone, stackBase, events, stageState,
    setTitle, commitTitle, createRevision, runEvaluation, repair, restack, decide, merge,
  };
}
