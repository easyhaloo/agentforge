import { ArrowRight } from "lucide-react";
import { overviewActivity } from "../data/overviewData";

type Props = {
  onNavigate: (page: string) => void;
};

export function ActivityFeed({ onNavigate }: Props) {
  return (
    <section className="card panel activity-panel">
      <div className="panel-head">
        <div>
          <h3>Activity stream</h3>
          <p>Latest events across your workspace</p>
        </div>
        <button className="link-button" type="button" onClick={() => onNavigate("Trails")}>
          View all <ArrowRight size={14} />
        </button>
      </div>
      {overviewActivity.map((event) => (
        <div className="activity-row" key={event.title}>
          <span className={`event-dot ${event.tone}`} />
          <div><b>{event.title}</b><small>{event.description}</small></div>
          <time>{event.time}</time>
        </div>
      ))}
    </section>
  );
}
