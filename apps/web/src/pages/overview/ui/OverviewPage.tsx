import { useState } from "react";
import type { CreatedChangeset } from "../model/types";
import { ActivityFeed } from "./ActivityFeed";
import { ChangeVelocityChart } from "./ChangeVelocityChart";
import { OverviewMetrics } from "./OverviewMetrics";
import { RecentChangesets } from "./RecentChangesets";
import { SelectedChangesetPanel } from "./SelectedChangesetPanel";

type Props = {
  onNavigate: (page: string) => void;
  onNotify: (message: string) => void;
  created: CreatedChangeset[];
};

export function OverviewPage({ onNavigate, onNotify, created }: Props) {
  const [selectedId, setSelectedId] = useState("CS-2481");

  return (
    <>
      <OverviewMetrics />
      <div className="dashboard-grid">
        <ChangeVelocityChart />
        <ActivityFeed onNavigate={onNavigate} />
      </div>
      <RecentChangesets
        created={created}
        onNavigate={onNavigate}
        onNotify={onNotify}
        onSelect={setSelectedId}
        selectedId={selectedId}
      />
      {selectedId && <SelectedChangesetPanel changesetId={selectedId} onNotify={onNotify} />}
    </>
  );
}
