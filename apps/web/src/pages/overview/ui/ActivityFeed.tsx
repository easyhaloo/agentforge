import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CURRENT_ORGANIZATION_HANDLE, orgPath } from "../../../shared/routing";
import { Button } from "../../../shared/ui";
import { overviewActivity } from "../data/overviewData";

export function ActivityFeed() {
  const { t } = useTranslation("overview");
  const navigate = useNavigate();
  return (
    <section className="card panel activity-panel">
      <div className="panel-head">
        <div>
          <h3>{t("activityFeed.title")}</h3>
          <p>{t("activityFeed.description")}</p>
        </div>
        <Button variant="ghost" size="small" onClick={() => navigate(orgPath(CURRENT_ORGANIZATION_HANDLE, "trails"))}>
          {t("activityFeed.viewAll")} <ArrowRight size={14} />
        </Button>
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
