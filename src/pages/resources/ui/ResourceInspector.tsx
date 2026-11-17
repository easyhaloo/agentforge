import { Activity, ArrowRight, Check, GitCommitHorizontal, ShieldCheck, X } from "lucide-react";
import type { Item, PageConfig } from "../data/resourceConfigs";

type Props = { page: string; config: PageConfig; current: Item | undefined; activity: string[]; onClose: () => void; onAction: () => void };

export function ResourceInspector({ page, config, current, activity, onClose, onAction }: Props) {
  return <aside className="card resource-detail">
    <div className="resource-detail-top"><span className="eyebrow">INSPECTOR</span><button className="icon-button" onClick={onClose}><X size={15} /></button></div>
    {current ? <>
      <div className="resource-detail-icon"><GitCommitHorizontal size={20} /></div>
      <h3>{current.name}</h3><div className="resource-id">{current.id}</div>
      <span className="resource-status detail-status">{current.status}</span>
      <div className="detail-meta">
        <div><span>Owner</span><b>{current.owner}</b></div>
        <div><span>Last updated</span><b>{current.updated}</b></div>
      </div>
      <div className="detail-divider" /><h4>{config.detailTitle}</h4>
      {config.signals.map((signal, index) => <div className="signal-row" key={signal}><span>{index + 1}</span>{signal}<ArrowRight size={13} /></div>)}
      <button className="button secondary detail-action" onClick={onAction}>Open {page.toLowerCase()} details <ArrowRight size={14} /></button>
    </> : <div className="empty">Select a resource to inspect its details.</div>}
    {activity.length > 0 && <div className="local-activity">
      <h4><Activity size={13} /> Local activity</h4>
      {activity.map((message, index) => <p key={message + index}><Check size={12} />{message}</p>)}
    </div>}
    <div className="prototype-callout"><ShieldCheck size={14} /><span>Demo environment. Actions update local UI state only; no remote operation is performed.</span></div>
  </aside>;
}
