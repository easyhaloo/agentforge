import { useState } from "react";
import { useTranslation } from "react-i18next";
import { request, type OrganizationSummary } from "../../shared/api/identity";
import { pipelines, type Definition, type Run } from "../../shared/api/pipelines";
import { Button, Modal } from "../../shared/ui";

type Intent = { action: "cancel" } | { action: "rerun" } | { action: "approve" | "reject"; step: string };

export function RunActions({ organization, actorId, run, definition, onChanged }: {
  organization: OrganizationSummary;
  actorId: string;
  run: Run;
  definition?: Definition;
  onChanged: (newRun?: Run) => void;
}) {
  const { t } = useTranslation("pipelines");
  const [intent, setIntent] = useState<Intent>();
  const active = run.status === "queued" || run.status === "running";
  const canRerun = !active && run.repository && run.actorId === actorId && !run.webhook && !run.integration && (!run.trigger || run.trigger.kind === "rerun");
  if (organization.role === "viewer" || (!active && !canRerun && !intent)) return null;
  const canDecide = organization.role === "owner" || organization.role === "admin";
  const waiting = canDecide && active ? definition?.stages.flatMap(stage => stage.jobs).flatMap(job => job.steps)
    .filter(step => step.uses === "control/approval@v1" && run.stepStatuses?.[step.id] === "waiting") ?? [] : [];
  async function apply(next: Intent) {
    if (next.action === "rerun") {
      const rerun = await pipelines.rerun(organization.id, run.id);
      setIntent(undefined);
      onChanged(rerun);
      return;
    }
    const base = `/api/v1/organizations/${encodeURIComponent(organization.id)}/pipeline-runs/${encodeURIComponent(run.id)}`;
    if (next.action === "cancel") {
      await request<void>(`${base}/cancel`, { method: "POST" });
    } else {
      await request<void>(`${base}/steps/${encodeURIComponent(next.step)}/decision`, {
        method: "POST", body: JSON.stringify({ approved: next.action === "approve" }),
      });
    }
    setIntent(undefined);
    onChanged();
  }
  return <div className="wf-run-actions">
    {active && <Button onClick={() => setIntent({ action: "cancel" })}>{t("runControls.cancel")}</Button>}
    {canRerun && <Button onClick={() => setIntent({ action: "rerun" })}>{t("runControls.rerun")}</Button>}
    {waiting.map(step => <Button key={step.id} onClick={() => setIntent({ action: "approve", step: step.id })}>
      {t("runControls.review", { step: step.id })}
    </Button>)}
    {intent && <Modal open title={"step" in intent ? t("runControls.review", { step: intent.step }) : t(`runControls.${intent.action}`)}
      onCancel={() => setIntent(undefined)} onOk={() => apply(intent)}
      okText={t(`runControls.${intent.action}`)} okVariant={intent.action === "cancel" || intent.action === "reject" ? "danger" : "primary"}>
      {"step" in intent ? <>
        <p>{t(`runControls.${intent.action}Hint`)}</p>
        <Button onClick={() => setIntent({ ...intent, action: intent.action === "approve" ? "reject" : "approve" })}>
          {t(intent.action === "approve" ? "runControls.chooseReject" : "runControls.chooseApprove")}
        </Button>
      </> : <p>{t(`runControls.${intent.action}Hint`)}</p>}
    </Modal>}
  </div>;
}
