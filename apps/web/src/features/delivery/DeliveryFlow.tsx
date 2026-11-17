import { stages } from "./model";
import { useDeliveryWorkflow } from "./hooks/useDeliveryWorkflow";
import { DeliveryFlowBanner } from "./ui/DeliveryFlowBanner";
import { DeliveryStageTrack } from "./ui/DeliveryStageTrack";
import { DeliveryWorkspace } from "./ui/DeliveryWorkspace";
import { WorkflowAuditPanel } from "./ui/WorkflowAuditPanel";
import { DeliveryFlowFooter } from "./ui/DeliveryFlowFooter";

type Props = { page: string; onNotify: (message: string) => void };

export function DeliveryFlow({ page, onNotify }: Props) {
  const workflow = useDeliveryWorkflow(onNotify);
  const stageIndex = page === "Self-healing" ? 1 : page === "Stacks" ? 0 : Math.max(0, stages.findIndex((stage) => stage.id === page));

  return <div className="delivery-flow">
    <DeliveryFlowBanner />
    <DeliveryStageTrack stages={stages} stageIndex={stageIndex} stageState={workflow.stageState} />
    <div className="flow-main-grid">
      <DeliveryWorkspace
        change={workflow.change}
        currentRevisionNumber={workflow.currentRevisionNumber}
        title={workflow.title}
        evaluations={workflow.evaluations}
        evaluationViews={workflow.evaluationViews}
        reviews={workflow.reviews}
        currentRevisionId={workflow.currentRevisionId}
        evidenceCurrent={workflow.evidenceCurrent}
        approved={workflow.approved}
        trailDone={workflow.trailDone}
        stackBase={workflow.stackBase}
        onTitleChange={workflow.setTitle}
        onTitleCommit={workflow.commitTitle}
        onCreateRevision={workflow.createRevision}
        onRunEvaluation={workflow.runEvaluation}
        onSelfHeal={workflow.repair}
        onRestack={workflow.restack}
        onDecide={workflow.decide}
        onMerge={workflow.merge}
      />
      <WorkflowAuditPanel events={workflow.events} />
    </div>
    <DeliveryFlowFooter />
  </div>;
}
