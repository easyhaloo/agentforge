import { Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import { overviewMetrics } from "../data/overviewData";
import type { OverviewMetricId } from "../model/types";

export function OverviewMetrics() {
  const { t } = useTranslation("overview");

  // The label of every metric is a translation, so the mapping is written out here: a
  // missing key then shows up as a missing key instead of an English sentence.
  const labels: Record<OverviewMetricId, string> = {
    activeChangesets: t("metrics.items.activeChangesets"),
    verificationPassRate: t("metrics.items.verificationPassRate"),
    openTrails: t("metrics.items.openTrails"),
    agentHoursSaved: t("metrics.items.agentHoursSaved"),
  };

  return (
    <section className="metric-grid" aria-label={t("metrics.ariaLabel")}>
      {overviewMetrics.map((metric) => (
        <article className="metric card" key={metric.id}>
          <div className="metric-top">
            {labels[metric.id]}
            <span><Activity size={15} /></span>
          </div>
          <strong>{metric.value}</strong>
          <small>
            {metric.deltaKey === "atRisk"
              ? t("metrics.deltas.atRisk", { count: metric.deltaCount ?? 0 })
              : metric.deltaKey === "thisMonth"
                ? t("metrics.deltas.thisMonth")
                : metric.delta}
          </small>
        </article>
      ))}
    </section>
  );
}
