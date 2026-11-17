import { Activity } from "lucide-react";
import { overviewMetrics } from "../data/overviewData";

export function OverviewMetrics() {
  return (
    <section className="metric-grid" aria-label="Workspace metrics">
      {overviewMetrics.map((metric) => (
        <article className="metric card" key={metric.label}>
          <div className="metric-top">
            {metric.label}
            <span><Activity size={15} /></span>
          </div>
          <strong>{metric.value}</strong>
          <small>{metric.delta}</small>
        </article>
      ))}
    </section>
  );
}
