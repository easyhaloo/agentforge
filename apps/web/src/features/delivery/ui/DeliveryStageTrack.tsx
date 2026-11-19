import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Stage } from "../model";

type Props = { stages: readonly Stage[]; stageIndex: number; stageState: readonly string[] };

export function DeliveryStageTrack({ stages, stageIndex, stageState }: Props) {
  const { t } = useTranslation("common");

  // The wording of a stage lives in the locale file; the id is what the route addresses.
  const labels: Record<string, { label: string; description: string }> = {
    "Changesets": { label: t("delivery.stages.changeset"), description: t("delivery.stages.changesetDescription") },
    "Eval": { label: t("delivery.stages.eval"), description: t("delivery.stages.evalDescription") },
    "Review": { label: t("delivery.stages.review"), description: t("delivery.stages.reviewDescription") },
    "Trails": { label: t("delivery.stages.trail"), description: t("delivery.stages.trailDescription") },
  };

  return <div className="flow-stage-track">
    {stages.map((stage, index) => {
      const copy = labels[stage.id] ?? { label: stage.id, description: "" };
      return <div
        className={"flow-stage " + (index === stageIndex ? "focused " : "") + (index < stageIndex ? "visited" : "")}
        key={stage.id}
      >
        <div className="flow-stage-top"><span>{index + 1}</span><b>{copy.label}</b><small>{stageState[index]}</small></div>
        <p>{copy.description}</p>
        {index < stages.length - 1 && <ArrowRight size={14} />}
      </div>;
    })}
  </div>;
}
