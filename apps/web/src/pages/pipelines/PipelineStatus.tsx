import { CircleDashed, CircleSlash, Clock3, Hourglass } from "lucide-react";
import { useTranslation } from "react-i18next";
import { pipelineStateKey } from "./pipeline-states";
import "./pipeline-status.css";

// GitHub Octicons check-circle-fill-16 and x-circle-fill-16 (MIT).
const resultPaths = {
  succeeded: "M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.751.751 0 0 0-.018-1.042.751.751 0 0 0-1.042-.018L6.75 9.19 5.28 7.72a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042l2 2a.75.75 0 0 0 1.06 0Z",
  failed: "M2.343 13.657A8 8 0 1 1 13.658 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L6.94 8 4.97 9.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94Z",
};

export function PipelineStatus({ state, size = 16 }: { state: string; size?: number }) {
  const { t } = useTranslation("pipelines");
  const status = pipelineStateKey(state);
  const label = t(status);
  const props = { className: "pipeline-status-icon", "data-state": status, role: "img", "aria-label": label } as const;
  if (status === "running" || status === "succeeded" || status === "failed") {
    return <svg {...props} width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <title>{label}</title>
      {status === "running" ? <>
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="2" opacity=".5" />
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="2" pathLength="4" strokeDasharray="1 3" />
        <circle cx="8" cy="8" r="4" />
      </> : <path d={resultPaths[status]} />}
    </svg>;
  }
  const Icon = status === "timed_out" ? Clock3 : status === "waiting" ? Hourglass : status === "cancelled" ? CircleSlash : CircleDashed;
  return <Icon {...props} size={size}><title>{label}</title></Icon>;
}
