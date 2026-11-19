import { GitBranch, GitCommitHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui";

type Props = { trailDone: boolean; stackBase: string; approved: boolean; onMerge: () => void };

export function TrailSummary({ trailDone, stackBase, approved, onMerge }: Props) {
  const { t } = useTranslation("common");
  return <div className="flow-subsection">
    <div className="flow-subhead"><h4><GitBranch size={14} /> {t("delivery.trail.title")}</h4><span>{trailDone ? t("delivery.trail.delivered") : t("delivery.trail.inProgress")}</span></div>
    <div className="trail-summary">
      <div><b>{t("delivery.trail.stackName")}</b><small>{t("delivery.trail.stackChangesets", { count: 3, base: stackBase })}</small></div>
      <div><b>{t("delivery.trail.trailName")}</b><small>{trailDone ? t("delivery.trail.completed", { completed: 6, total: 6 }) : t("delivery.trail.waiting", { completed: 4, total: 6 })}</small></div>
      <Button variant="primary" size="small" className="compact" disabled={!approved} onClick={onMerge}><GitCommitHorizontal size={14} /> {t("delivery.trail.merge")}</Button>
    </div>
  </div>;
}
