import { Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import { overviewMetrics } from "../data/overviewData";

export function OverviewMetrics() {
  const { t } = useTranslation("overview");
  return (
    <section className="metric-grid" aria-label={t("metrics.ariaLabel")}>
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
