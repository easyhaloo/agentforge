import { Activity, ArrowRight, Check, GitCommitHorizontal, ShieldCheck } from "lucide-react";
import { Button, Empty } from "../../../shared/ui";
import type { PageConfig } from "../data/resourceConfigs";
import type { ResourceRow } from "../data/resourceRecords";

type Props = {
  current: ResourceRow | undefined;
  config: Pick<PageConfig, "detailTitle" | "signals">;
  activity: string[];
  onClose: () => void;
};

export function ResourceInspector({ current, config, activity, onClose }: Props) {
  return <aside className="card resource-detail">
    <div className="resource-detail-top"><span className="eyebrow">INSPECTOR</span><Button variant="ghost" size="small" className="icon-button" onClick={onClose} aria-label="Close inspector"><span aria-hidden="true">×</span></Button></div>
    {current ? <>
      <div className="resource-detail-icon"><GitCommitHorizontal size={20} /></div>
      <h3>{current.name}</h3><div className="resource-id">{current.id}</div>
      <span className="resource-status detail-status">{current.status}</span>
      <div className="detail-meta">
        <div><span>Owner</span><b>{current.owner}</b></div>
        <div><span>Last updated</span><b>{current.updated}</b></div>
      </div>
      <div className="detail-divider" /><h4>{config.detailTitle}</h4>
      <p className="inspector-description">{current.detail}</p>
      {config.signals.map((signal, index) => <div className="signal-row" key={signal}><span>{index + 1}</span>{signal}<ArrowRight size={13} /></div>)}
    </> : <Empty title="No resource selected" description="Select a resource from the list to inspect its details." />}
    {activity.length > 0 && <div className="local-activity">
      <h4><Activity size={13} /> Local activity</h4>
      {activity.map((message, index) => <p key={message + index}><Check size={12} />{message}</p>)}
    </div>}
    <div className="prototype-callout"><ShieldCheck size={14} /><span>Demo environment. Actions update local UI state only; no remote operation is performed.</span></div>
  </aside>;
}
