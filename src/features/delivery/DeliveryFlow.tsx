import { useMemo } from "react";
import { usePersistentState } from "../../shared/hooks/usePersistentState";
import { canApproveRevision, canMergeRevision, isEvidenceCurrent, revisionKey } from "../../domain/delivery";
import { initialChange, initialEvaluations, initialReviews, stages, type Change, type Evaluation, type Review } from "./model";
import { DeliveryFlowBanner } from "./ui/DeliveryFlowBanner";
import { DeliveryStageTrack } from "./ui/DeliveryStageTrack";
import { DeliveryWorkspace } from "./ui/DeliveryWorkspace";
import { WorkflowAuditPanel } from "./ui/WorkflowAuditPanel";
import { DeliveryFlowFooter } from "./ui/DeliveryFlowFooter";

type Props = { page: string; onNotify: (message: string) => void };

export function DeliveryFlow({ page, onNotify }: Props) {
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
    const nextRevision = change.revision + 1;
    setChange({ ...change, revision: nextRevision, status: "Draft" });
    setTrailDone(false);
    setReviews([{
      id: "REV-" + (891 + nextRevision),
      revision: nextRevision,
      revisionId: revisionKey(change.id, nextRevision),
      decision: "Pending",
      reviewer: "Mina",
    }, ...reviews]);
    record("Created " + change.id + " r" + nextRevision + "; previous evidence is now stale");
  };

  const runEvaluation = () => {
    const passed = repairCount < 1 || change.revision > 3;
    const evaluation: Evaluation = {
      id: "EVL-" + (5510 + evaluations.length),
      revision: change.revision,
      revisionId: currentRevisionId,
      status: passed ? "Passed" : "Failed",
      checks: 38,
      createdAt: "Just now",
    };
    setEvaluations([evaluation, ...evaluations]);
    setChange({ ...change, status: passed ? "Ready for review" : "Evaluating" });
    record(evaluation.id + " " + (passed ? "passed" : "failed") + " on " + change.id + " r" + change.revision);
  };

  const decide = (decision: "Approved" | "Changes requested") => {
    if (!canApproveRevision(currentRevisionId, latestEvaluation)) {
      record("Review blocked: current passing evidence is required");
      return;
    }
    const review: Review = {
      id: "REV-" + (892 + reviews.length),
      revision: change.revision,
      revisionId: currentRevisionId,
      decision,
      reviewer: "You",
    };
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

  const stageIndex = page === "Self-healing" ? 1 : page === "Stacks" ? 0 : Math.max(0, stages.findIndex((stage) => stage.id === page));

  return <div className="delivery-flow">
    <DeliveryFlowBanner />
    <DeliveryStageTrack stages={stages} stageIndex={stageIndex} stageState={stageState} />
    <div className="flow-main-grid">
      <DeliveryWorkspace
        change={change}
        title={title}
        evaluations={evaluations}
        reviews={reviews}
        currentRevisionId={currentRevisionId}
        evidenceCurrent={evidenceCurrent}
        approved={approved}
        trailDone={trailDone}
        stackBase={stackBase}
        onTitleChange={setTitle}
        onTitleCommit={() => setChange({ ...change, title })}
        onCreateRevision={createRevision}
        onRunEvaluation={runEvaluation}
        onSelfHeal={repair}
        onRestack={restack}
        onDecide={decide}
        onMerge={merge}
      />
      <WorkflowAuditPanel events={events} />
    </div>
    <DeliveryFlowFooter />
  </div>;
}
