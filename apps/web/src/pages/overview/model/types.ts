export type CreatedChangeset = {
  id: string;
  title: string;
};

export type OverviewChangesetRow = {
  id: string;
  title: string;
  project: string;
  status: string;
  /** When the row was last touched; rendered with the shared relative-time helper. */
  updatedAt: string;
};

/** The metrics the overview shows. The label lives in the locale file, the value is demo data. */
export type OverviewMetricId =
  | "activeChangesets"
  | "verificationPassRate"
  | "openTrails"
  | "agentHoursSaved";

export type OverviewMetric = {
  id: OverviewMetricId;
  value: string;
  /** A delta that reads the same in every language, such as "+12%". */
  delta?: string;
  /** A delta that is a sentence and therefore lives in the locale file. */
  deltaKey?: "atRisk" | "thisMonth";
  /** The count a worded delta counts. */
  deltaCount?: number;
};

/** The activity events the overview shows. Every wording lives in the locale file. */
export type OverviewActivityEvent =
  | { id: "verified"; changeset: string; count: number; tone: string; updatedAt: string }
  | { id: "reviewRequested"; changeset: string; reviewer: string; tone: string; updatedAt: string }
  | { id: "trailAtRisk"; name: string; count: number; tone: string; updatedAt: string }
  | { id: "workspaceCreated"; workspace: string; tone: string; updatedAt: string };
