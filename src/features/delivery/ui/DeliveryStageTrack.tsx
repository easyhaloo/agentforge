import { ArrowRight } from "lucide-react";
import type { stages } from "../model";

type Stage = (typeof stages)[number];
type Props = { stages: readonly Stage[]; stageIndex: number; stageState: readonly string[] };

export function DeliveryStageTrack({ stages, stageIndex, stageState }: Props) {
  return <div className="flow-stage-track">
    {stages.map((stage, index) => <div
      className={"flow-stage " + (index === stageIndex ? "focused " : "") + (index < stageIndex ? "visited" : "")}
      key={stage.id}
    >
      <div className="flow-stage-top"><span>{index + 1}</span><b>{stage.label}</b><small>{stageState[index]}</small></div>
      <p>{stage.desc}</p>
      {index < stages.length - 1 && <ArrowRight size={14} />}
    </div>)}
  </div>;
}
