import { Check, CircleAlert, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDateFormatting } from "../../../shared/i18n/format";
import { Empty } from "../../../shared/ui";
import type { EvaluationView } from "../model";

type Props = { evaluations: EvaluationView[]; evidenceCurrent: boolean };

export function EvaluationEvidence({ evaluations, evidenceCurrent }: Props) {
  const { t } = useTranslation("common");
  const { formatDateTime } = useDateFormatting();
  return <div className="flow-subsection">
    <div className="flow-subhead"><h4><ShieldCheck size={14} /> {t("delivery.evidence.title")}</h4><span>{evidenceCurrent ? t("delivery.evidence.current") : t("delivery.evidence.stale")}</span></div>
    {evaluations.length === 0 ? <Empty title={t("delivery.evidence.emptyTitle")} description={t("delivery.evidence.emptyDescription")} /> :
      evaluations.slice(0, 3).map((evaluation) => <div className="evidence-row" key={evaluation.id}>
        <span className={evaluation.status === "Passed" ? "evidence-icon pass" : "evidence-icon fail"}>
          {evaluation.status === "Passed" ? <Check size={13} /> : <CircleAlert size={13} />}
        </span>
        <div><b>{evaluation.id} · r{evaluation.revisionNumber ?? "?"}</b><small>{[t("delivery.evidence.checks", { count: evaluation.checks }), formatDateTime(evaluation.createdAt)].filter(Boolean).join(" · ")}</small></div>
        <strong>{evaluation.status === "Passed" ? t("delivery.evidence.passed") : t("delivery.evidence.failed")}</strong>
      </div>)}
  </div>;
}
