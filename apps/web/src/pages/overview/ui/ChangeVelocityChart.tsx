import { ChevronDown } from "lucide-react";

export function ChangeVelocityChart() {
  return (
    <section className="card panel">
      <div className="panel-head">
        <div>
          <h3>Change velocity</h3>
          <p>Changesets created and merged · Last 7 days</p>
        </div>
        <button className="select-like" type="button">
          Last 7 days <ChevronDown size={13} />
        </button>
      </div>
      <div className="chart">
        <div className="chart-y">
          <span>40</span><span>30</span><span>20</span><span>10</span><span>0</span>
        </div>
        <div className="chart-main">
          <div className="grid-lines"><i /><i /><i /><i /><i /></div>
          <svg viewBox="0 0 600 190" preserveAspectRatio="none" role="img" aria-label="Change velocity trend over seven days">
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
            <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
          </div>
        </div>
      </div>
    </section>
  );
}
