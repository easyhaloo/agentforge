import { GitBranch, GitCommitHorizontal } from "lucide-react";

type Props = { trailDone: boolean; stackBase: string; approved: boolean; onMerge: () => void };

export function TrailSummary({ trailDone, stackBase, approved, onMerge }: Props) {
  return <div className="flow-subsection">
    <div className="flow-subhead"><h4><GitBranch size={14} /> Stack & Trail</h4><span>{trailDone ? "Delivered" : "In progress"}</span></div>
    <div className="trail-summary">
      <div><b>STK-018 · Auth service rollout</b><small>3 changesets · base {stackBase}</small></div>
      <div><b>TRL-042 · Migrate authentication API</b><small>{trailDone ? "6/6 changesets completed" : "4/6 changesets · waiting on this changeset"}</small></div>
      <button className="button primary compact" disabled={!approved} onClick={onMerge}><GitCommitHorizontal size={14} /> Merge & complete Trail</button>
    </div>
  </div>;
}
