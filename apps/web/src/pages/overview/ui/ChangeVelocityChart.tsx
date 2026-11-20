import { useTranslation } from "react-i18next";

export function ChangeVelocityChart() {
  const { t } = useTranslation("overview");
  const last7Days = t("changeVelocity.last7Days");

  return (
    <section className="card panel">
      <div className="panel-head">
        <div>
          <h3>{t("changeVelocity.title")}</h3>
          <p>{t("changeVelocity.description")}</p>
        </div>
        <span className="select-like" aria-label={t("changeVelocity.timeRangeAriaLabel", { range: last7Days })}>
          {last7Days}
        </span>
      </div>
      <div className="chart">
        <div className="chart-y">
          <span>40</span><span>30</span><span>20</span><span>10</span><span>0</span>
        </div>
        <div className="chart-main">
          <div className="grid-lines"><i /><i /><i /><i /><i /></div>
          <svg viewBox="0 0 600 190" preserveAspectRatio="none" role="img" aria-label={t("changeVelocity.chartAriaLabel")}>
            <defs>
              <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#8b7cff" stopOpacity=".32" />
                <stop offset="100%" stopColor="#8b7cff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M0 145 C35 132 45 115 85 125 S140 95 170 105 S220 65 255 90 S305 105 340 70 S390 78 425 52 S475 70 510 36 S560 45 600 18 L600 190 L0 190Z" fill="url(#fill)" />
            <path d="M0 145 C35 132 45 115 85 125 S140 95 170 105 S220 65 255 90 S305 105 340 70 S390 78 425 52 S475 70 510 36 S560 45 600 18" fill="none" stroke="#9b8cff" strokeWidth="3" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="chart-x">
            <span>{t("changeVelocity.days.mon")}</span>
            <span>{t("changeVelocity.days.tue")}</span>
            <span>{t("changeVelocity.days.wed")}</span>
            <span>{t("changeVelocity.days.thu")}</span>
            <span>{t("changeVelocity.days.fri")}</span>
            <span>{t("changeVelocity.days.sat")}</span>
            <span>{t("changeVelocity.days.sun")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
