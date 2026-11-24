import { Activity, CircleAlert, CircleCheck, Clock3, FlaskConical, GitCommitHorizontal, Play, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { canEditChangeset } from "../../domain/delivery";
import { Button } from "../../shared/ui";
import { stages } from "./model";
import { useDeliveryWorkflow } from "./hooks/useDeliveryWorkflow";
import { DeliveryStageTrack } from "./ui/DeliveryStageTrack";
import { DeliveryWorkspace } from "./ui/DeliveryWorkspace";
import { WorkflowAuditPanel } from "./ui/WorkflowAuditPanel";
import { DeliveryFlowFooter } from "./ui/DeliveryFlowFooter";
import "./self-healing.css";

type Props = { page: string; onNotify: (message: string) => void };

export function DeliveryFlow({ page, onNotify }: Props) {
  const { t } = useTranslation("common");
  const workflow = useDeliveryWorkflow(onNotify);
  const evaluation = workflow.evaluations.find(item => item.revisionId === workflow.currentRevisionId);
  const editable = canEditChangeset(workflow.change.status);
  const ResultIcon = !evaluation ? Clock3 : evaluation.status === "Passed" ? CircleCheck : CircleAlert;
  const resultLabel = !evaluation ? t("delivery.healing.pending") : evaluation.status === "Passed" ? t("delivery.evidence.passed") : t("delivery.evidence.failed");
  const resultTone = !evaluation ? "pending" : evaluation.status === "Passed" ? "passed" : "failed";
  const stageIndex = page === "Self-healing" ? 1 : Math.max(0, stages.findIndex((stage) => stage.id === page));

  return <div className="delivery-flow">
    <section className="self-healing" aria-labelledby="repair-heading">
      <p className="self-healing-notice"><FlaskConical size={16} aria-hidden="true" />{t("delivery.healing.localNotice")}</p>
      <div className="self-healing-panel">
        <header>
          <div><h2 id="repair-heading">{workflow.change.title}</h2>
            <p>{workflow.change.id} · {t("delivery.healing.revision", { number: workflow.currentRevisionNumber })}</p>
          </div>
          <span className={`self-healing-result self-healing-result--${resultTone}`} role="status"><ResultIcon size={16} aria-hidden="true" />{resultLabel}</span>
        </header>
        <ol className="self-healing-steps">
          <li><GitCommitHorizontal size={18} aria-hidden="true" /><div><strong>{t("delivery.healing.prepare")}</strong><p>{t("delivery.healing.prepareHint")}</p></div>
            <Button variant={evaluation ? "primary" : "secondary"} disabled={!editable} onClick={workflow.repair}><Wrench size={15} aria-hidden="true" />{t("delivery.healing.prepareAction")}</Button>
          </li>
          <li><Activity size={18} aria-hidden="true" /><div><strong>{t("delivery.healing.verify")}</strong><p>{t("delivery.healing.verifyHint")}</p></div>
            <Button variant={evaluation ? "secondary" : "primary"} disabled={!editable} onClick={workflow.runEvaluation}><Play size={15} aria-hidden="true" />{t("delivery.healing.verifyAction")}</Button>
          </li>
        </ol>
        {!editable && <p className="self-healing-closed">{t("delivery.healing.closed")}</p>}
      </div>
    </section>
    <details className="self-healing-details">
      <summary>{t("delivery.healing.details")}</summary>
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
    </details>
  </div>;
}
