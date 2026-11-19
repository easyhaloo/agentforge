import type {
  OverviewActivityEvent,
  OverviewChangesetRow,
  OverviewMetric,
} from "../model/types";

/**
 * A timestamp the given number of minutes ago.
 *
 * The overview shows how long ago something happened, so the demo rows carry a real
 * timestamp and the UI renders it with the shared relative-time helper. That keeps the
 * wording in one place and in the language the interface is rendered in.
 */
const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();

export const overviewMetrics: OverviewMetric[] = [
  { id: "activeChangesets", value: "28", delta: "+12%" },
  { id: "verificationPassRate", value: "96.4%", delta: "+2.1%" },
  { id: "openTrails", value: "7", deltaKey: "atRisk", deltaCount: 2 },
  { id: "agentHoursSaved", value: "142h", deltaKey: "thisMonth" },
];

export const recentChangesetSeeds: OverviewChangesetRow[] = [
  { id: "CS-2481", title: "Refactor auth token lifecycle", project: "web-platform", status: "Ready for review", updatedAt: minutesAgo(4) },
  { id: "CS-2479", title: "Add retry policy to webhook worker", project: "event-service", status: "Evaluating", updatedAt: minutesAgo(18) },
  { id: "CS-2476", title: "Improve repository graph indexing", project: "agentforge-core", status: "Changes requested", updatedAt: minutesAgo(60) },
  { id: "CS-2472", title: "Update billing usage aggregation", project: "billing-api", status: "Merged", updatedAt: minutesAgo(180) },
  { id: "CS-2468", title: "Fix workspace cleanup race", project: "runtime", status: "Draft", updatedAt: minutesAgo(1440) },
];

export const overviewActivity: OverviewActivityEvent[] = [
  { id: "verified", changeset: "CS-2479", count: 42, tone: "green", updatedAt: minutesAgo(12) },
  { id: "reviewRequested", changeset: "CS-2481", reviewer: "Mina", tone: "purple", updatedAt: minutesAgo(28) },
  { id: "trailAtRisk", name: "API migration", count: 1, tone: "orange", updatedAt: minutesAgo(60) },
  { id: "workspaceCreated", workspace: "ws-092", tone: "blue", updatedAt: minutesAgo(120) },
];
