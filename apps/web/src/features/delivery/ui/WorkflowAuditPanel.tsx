import { Activity, GitCommitHorizontal, ShieldCheck, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Empty } from "../../../shared/ui";

type Props = { events: string[] };

export function WorkflowAuditPanel({ events }: Props) {
  const { t } = useTranslation("common");
  return <aside className="card flow-aside">
    <div className="flow-section-head">
      <div><span className="eyebrow">{t("delivery.audit.eyebrow")}</span><h3>{t("delivery.audit.title")}</h3><p>{t("delivery.audit.description")}</p></div>
      <Activity size={16} />
    </div>
    <div className="event-timeline">
      {events.length === 0 ? <Empty title={t("delivery.audit.emptyTitle")} description={t("delivery.audit.emptyDescription")} /> :
        events.map((event, index) => <div className="timeline-event" key={event + index}>
          <span className="timeline-dot" /><div><b>{event}</b><small>{index === 0 ? t("time.justNow") : t("time.minutesAgo", { count: index * 4 })}</small></div>
        </div>)}
    </div>
    <div className="flow-invariant"><ShieldCheck size={15} /><div><b>{t("delivery.audit.mergeGateTitle")}</b><p>{t("delivery.audit.mergeGateDescription")}</p></div></div>
    <div className="flow-invariant"><GitCommitHorizontal size={15} /><div><b>{t("delivery.audit.invalidationTitle")}</b><p>{t("delivery.audit.invalidationDescription")}</p></div></div>
    <div className="prototype-callout"><Sparkles size={14} /> {t("delivery.audit.demoNotice")}</div>
  </aside>;
}
