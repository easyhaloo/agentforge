import { Activity, GitCommitHorizontal, ShieldCheck, Sparkles } from "lucide-react";

type Props = { events: string[] };

export function WorkflowAuditPanel({ events }: Props) {
  return <aside className="card flow-aside">
    <div className="flow-section-head">
      <div><span className="eyebrow">AUDIT TRAIL</span><h3>Workflow events</h3><p>Ordered activity for this demo changeset.</p></div>
      <Activity size={16} />
    </div>
    <div className="event-timeline">
      {events.map((event, index) => <div className="timeline-event" key={event + index}>
        <span className="timeline-dot" /><div><b>{event}</b><small>{index === 0 ? "Just now" : (index * 4) + " min ago"}</small></div>
      </div>)}
    </div>
    <div className="flow-invariant"><ShieldCheck size={15} /><div><b>Merge gate</b><p>Merge requires a passing evaluation for the exact current revision and an approval for that same revision.</p></div></div>
    <div className="flow-invariant"><GitCommitHorizontal size={15} /><div><b>Evidence invalidation</b><p>Creating a new revision makes prior evaluation evidence and review decisions stale.</p></div></div>
    <div className="prototype-callout"><Sparkles size={14} /> All records are local demo state. No Git commit, remote CI, reviewer notification or merge operation is performed.</div>
  </aside>;
}
