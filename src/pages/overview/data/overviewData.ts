import type { OverviewChangesetRow } from "../model/types";

export const overviewMetrics = [
  { label: "Active changesets", value: "28", delta: "+12%" },
  { label: "Verification pass rate", value: "96.4%", delta: "+2.1%" },
  { label: "Open trails", value: "7", delta: "2 at risk" },
  { label: "Agent hours saved", value: "142h", delta: "This month" },
] as const;

export const recentChangesetSeeds: OverviewChangesetRow[] = [
  { id: "CS-2481", title: "Refactor auth token lifecycle", project: "web-platform", status: "Ready for review", updated: "4m ago" },
  { id: "CS-2479", title: "Add retry policy to webhook worker", project: "event-service", status: "Evaluating", updated: "18m ago" },
  { id: "CS-2476", title: "Improve repository graph indexing", project: "agentforge-core", status: "Changes requested", updated: "1h ago" },
  { id: "CS-2472", title: "Update billing usage aggregation", project: "billing-api", status: "Merged", updated: "3h ago" },
  { id: "CS-2468", title: "Fix workspace cleanup race", project: "runtime", status: "Draft", updated: "Yesterday" },
];

export const overviewActivity = [
  { title: "Changeset verified", description: "CS-2479 passed all 42 checks", time: "12 min ago", tone: "green" },
  { title: "Review requested", description: "Mina requested review on CS-2481", time: "28 min ago", tone: "purple" },
  { title: "Trail at risk", description: "API migration is waiting on 1 dependency", time: "1 hr ago", tone: "orange" },
  { title: "Workspace created", description: "Agent workspace ws-092 is ready", time: "2 hr ago", tone: "blue" },
] as const;
