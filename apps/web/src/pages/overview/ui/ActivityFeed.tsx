import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { CURRENT_ORGANIZATION_HANDLE, orgPath } from "../../../shared/routing";
import { formatRelativeTime } from "../../../shared/i18n/format";
import { Button } from "../../../shared/ui";
import { overviewActivity } from "../data/overviewData";
import type { OverviewActivityEvent } from "../model/types";

/** The title and the description of an activity event, in the interface language. */
function describeEvent(event: OverviewActivityEvent, t: TFunction): { title: string; description: string } {
  switch (event.id) {
    case "verified":
      return {
        title: t("activityFeed.events.verified.title"),
        description: t("activityFeed.events.verified.description", { changeset: event.changeset, count: event.count }),
      };
    case "reviewRequested":
      return {
        title: t("activityFeed.events.reviewRequested.title"),
        description: t("activityFeed.events.reviewRequested.description", { changeset: event.changeset, reviewer: event.reviewer }),
      };
    case "trailAtRisk":
      return {
        title: t("activityFeed.events.trailAtRisk.title"),
        description: t("activityFeed.events.trailAtRisk.description", { name: event.name, count: event.count }),
      };
    case "workspaceCreated":
      return {
        title: t("activityFeed.events.workspaceCreated.title"),
        description: t("activityFeed.events.workspaceCreated.description", { workspace: event.workspace }),
      };
  }
}

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
      {overviewActivity.map((event) => {
        const copy = describeEvent(event, t);
        return (
          <div className="activity-row" key={event.id}>
            <span className={`event-dot ${event.tone}`} />
            <div><b>{copy.title}</b><small>{copy.description}</small></div>
            <time>{formatRelativeTime(event.updatedAt)}</time>
          </div>
        );
      })}
    </section>
  );
}
