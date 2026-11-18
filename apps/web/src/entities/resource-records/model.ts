export type ResourceRow = {
  id: string;
  name: string;
  detail: string;
  status: string;
  updated: string;
  owner: string;
};

type RecordBase<Kind extends string> = {
  kind: Kind;
  id: string;
  name: string;
  owner: string;
};

export type ProjectRecord = RecordBase<"project"> & {
  description: string; repositoryCount: number; lifecycle: string; updatedAt: string;
};
export type RepositoryRecord = RecordBase<"repository"> & {
  projectName: string; language: string; health: string; updatedAt: string;
};
export type WorkspaceRecord = RecordBase<"workspace"> & {
  changesetId: string; runtime: string; state: string; updatedAt: string;
};
export type ChangesetRecord = RecordBase<"changeset"> & {
  revisionNumber: number; repositoryName: string; status: string; updatedAt: string;
};
export type TrailRecord = RecordBase<"trail"> & {
  completedChangesets: number; totalChangesets: number; repositoryCount: number; health: string; updatedAt: string;
};
export type StackRecord = RecordBase<"stack"> & {
  changesetCount: number; baseBranch: string; state: string; updatedAt: string;
};
export type ReviewRecord = RecordBase<"review"> & {
  changesetId: string; changesetTitle: string; reviewer: string; fileCount: number; decision: string; updatedAt: string;
};
export type EvaluationRecord = RecordBase<"evaluation"> & {
  changesetId: string; changesetTitle: string; checkCount: number; suiteCount: number; result: string; updatedAt: string;
};
export type RepairSessionRecord = RecordBase<"repair-session"> & {
  trigger: string; attempt: number; maxAttempts: number; state: string; updatedAt: string;
};
export type MemoryEntryRecord = RecordBase<"memory-entry"> & {
  category: string; source: string; confidence: string; updatedAt: string;
};
export type PipelineRunRecord = RecordBase<"pipeline-run"> & {
  changesetId: string; changesetTitle: string; workflow: string; result: string; updatedAt: string;
};
export type SecurityFindingRecord = RecordBase<"security-finding"> & {
  resource: string; scan: string; severity: string; updatedAt: string;
};
export type GovernancePolicyRecord = RecordBase<"governance-policy"> & {
  scope: string; enforcement: string; policyState: string; updatedAt: string;
};
export type UsageRecord = RecordBase<"usage"> & {
  resource: string; usage: string; cost: string; updatedAt: string;
};
export type SettingRecord = RecordBase<"setting"> & {
  description: string; scope: string; state: string; updatedAt: string;
};
export type UnclassifiedResourceRecord = RecordBase<"unclassified"> & {
  detail: string; status: string; updated: string;
};

export type ResourceRecord =
  | ProjectRecord | RepositoryRecord | WorkspaceRecord | ChangesetRecord
  | TrailRecord | StackRecord | ReviewRecord | EvaluationRecord
  | RepairSessionRecord | MemoryEntryRecord | PipelineRunRecord
  | SecurityFindingRecord | GovernancePolicyRecord | UsageRecord
  | SettingRecord | UnclassifiedResourceRecord;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function legacyRow(value: unknown): ResourceRow | null {
  if (!isObject(value)) return null;
  const fields = ["id", "name", "detail", "status", "updated", "owner"] as const;
  const values = fields.map((field) => value[field]);
  if (!values.every(isString)) return null;
  const [id, name, detail, status, updated, owner] = values as [string, string, string, string, string, string];
  return { id, name, detail, status, updated, owner };
}

function base(row: ResourceRow) {
  return { id: row.id, name: row.name, owner: row.owner, updatedAt: row.updated };
}

function splitDetail(detail: string): [string, string] {
  const separator = detail.indexOf(" · ");
  return separator < 0
    ? [detail, ""]
    : [detail.slice(0, separator), detail.slice(separator + 3)];
}

function fromLegacy(row: ResourceRow, page: string): ResourceRecord {
  const common = base(row);
  switch (page) {
    case "Projects": {
      const match = row.detail.match(/^(\d+) repositories · (.+)$/);
      return { kind: "project", ...common, repositoryCount: match ? Number(match[1]) : 0, description: match?.[2] ?? row.detail, lifecycle: row.status };
    }
    case "Workspaces": {
      const [changesetId, runtime] = splitDetail(row.detail);
      return { kind: "workspace", ...common, changesetId: changesetId || "Unlinked", runtime, state: row.status };
    }
    case "Changesets": {
      const match = row.detail.match(/^r(\d+) · (.+)$/);
      return { kind: "changeset", ...common, revisionNumber: match ? Number(match[1]) : 0, repositoryName: match?.[2] ?? row.detail, status: row.status };
    }
    case "Trails": {
      const match = row.detail.match(/^(\d+)\/(\d+) changesets · (\d+) repositories$/);
      return { kind: "trail", ...common, completedChangesets: match ? Number(match[1]) : 0, totalChangesets: match ? Number(match[2]) : 0, repositoryCount: match ? Number(match[3]) : 0, health: row.status };
    }
    case "Stacks": {
      const match = row.detail.match(/^(\d+) changesets · (.+)$/);
      return { kind: "stack", ...common, changesetCount: match ? Number(match[1]) : 0, baseBranch: match?.[2] ?? row.detail, state: row.status };
    }
    case "Review": {
      const [reviewer, files] = splitDetail(row.detail);
      const [changesetId, changesetTitle] = splitDetail(row.name);
      const fileCount = Number(files.match(/^(\d+) files?$/)?.[1] ?? 0);
      return { kind: "review", ...common, changesetId, changesetTitle, reviewer, fileCount, decision: row.status };
    }
    case "Eval": {
      const [checks, suites] = splitDetail(row.detail);
      const [changesetId, changesetTitle] = splitDetail(row.name);
      return { kind: "evaluation", ...common, changesetId, changesetTitle, checkCount: Number(checks.match(/^(\d+) checks?$/)?.[1] ?? 0), suiteCount: Number(suites.match(/^(\d+) suites?$/)?.[1] ?? 0), result: row.status };
    }
    case "Self-healing": {
      const match = row.detail.match(/^Attempt (\d+) of (\d+)$/);
      return { kind: "repair-session", ...common, trigger: row.name, attempt: match ? Number(match[1]) : 0, maxAttempts: match ? Number(match[2]) : 0, state: row.status };
    }
    case "Memory": {
      const [category, source] = splitDetail(row.detail);
      return { kind: "memory-entry", ...common, category, source, confidence: row.status };
    }
    case "CI / CD": {
      const [changesetId, changesetTitle] = splitDetail(row.name);
      return { kind: "pipeline-run", ...common, changesetId, changesetTitle, workflow: row.detail, result: row.status };
    }
    case "Security": {
      const [resource, scan] = splitDetail(row.detail);
      return { kind: "security-finding", ...common, resource, scan, severity: row.status };
    }
    case "Governance": {
      const [scope, enforcement] = splitDetail(row.detail);
      return { kind: "governance-policy", ...common, scope, enforcement: row.status, policyState: row.updated };
    }
    case "Cost & Usage": {
      const [resource, usage] = splitDetail(row.detail);
      return { kind: "usage", ...common, resource, usage, cost: row.status };
    }
    case "Settings":
      return { kind: "setting", ...common, description: row.detail, scope: row.status, state: row.updated };
    default:
      return { kind: "unclassified", id: row.id, name: row.name, owner: row.owner, detail: row.detail, status: row.status, updated: row.updated };
  }
}

export function toResourceRow(record: ResourceRecord): ResourceRow {
  switch (record.kind) {
    case "project":
      return { id: record.id, name: record.name, detail: `${record.repositoryCount} repositories · ${record.description}`, status: record.lifecycle, updated: record.updatedAt, owner: record.owner };
    case "repository":
      return { id: record.id, name: record.name, detail: `Project ${record.projectName} · ${record.language}`, status: record.health, updated: record.updatedAt, owner: record.owner };
    case "workspace":
      return { id: record.id, name: record.name, detail: `${record.changesetId} · ${record.runtime}`, status: record.state, updated: record.updatedAt, owner: record.owner };
    case "changeset":
      return { id: record.id, name: record.name, detail: `r${record.revisionNumber} · ${record.repositoryName}`, status: record.status, updated: record.updatedAt, owner: record.owner };
    case "trail":
      return { id: record.id, name: record.name, detail: `${record.completedChangesets}/${record.totalChangesets} changesets · ${record.repositoryCount} repositories`, status: record.health, updated: record.updatedAt, owner: record.owner };
    case "stack":
      return { id: record.id, name: record.name, detail: `${record.changesetCount} changesets · ${record.baseBranch}`, status: record.state, updated: record.updatedAt, owner: record.owner };
    case "review":
      return { id: record.id, name: `${record.changesetId} · ${record.changesetTitle}`, detail: `${record.reviewer} · ${record.fileCount} files`, status: record.decision, updated: record.updatedAt, owner: record.owner };
    case "evaluation":
      return { id: record.id, name: `${record.changesetId} · ${record.changesetTitle}`, detail: `${record.checkCount} checks · ${record.suiteCount} suites`, status: record.result, updated: record.updatedAt, owner: record.owner };
    case "repair-session":
      return { id: record.id, name: record.trigger, detail: `Attempt ${record.attempt} of ${record.maxAttempts}`, status: record.state, updated: record.updatedAt, owner: record.owner };
    case "memory-entry":
      return { id: record.id, name: record.name, detail: `${record.category} · ${record.source}`, status: record.confidence, updated: record.updatedAt, owner: record.owner };
    case "pipeline-run":
      return { id: record.id, name: `${record.changesetId} · ${record.changesetTitle}`, detail: record.workflow, status: record.result, updated: record.updatedAt, owner: record.owner };
    case "security-finding":
      return { id: record.id, name: record.name, detail: `${record.resource} · ${record.scan}`, status: record.severity, updated: record.updatedAt, owner: record.owner };
    case "governance-policy":
      return { id: record.id, name: record.name, detail: `${record.scope} · ${record.enforcement}`, status: record.enforcement, updated: record.policyState, owner: record.owner };
    case "usage":
      return { id: record.id, name: record.name, detail: `${record.resource} · ${record.usage}`, status: record.cost, updated: record.updatedAt, owner: record.owner };
    case "setting":
      return { id: record.id, name: record.name, detail: record.description, status: record.scope, updated: record.state, owner: record.owner };
    case "unclassified":
      return { id: record.id, name: record.name, detail: record.detail, status: record.status, updated: record.updated, owner: record.owner };
  }
}

function isResourceRecord(value: unknown): value is ResourceRecord {
  if (!isObject(value) || !isString(value.kind) || !isString(value.id) || !isString(value.name) || !isString(value.owner)) return false;
  const stringFields: Record<string, string[]> = {
    project: ["description", "lifecycle", "updatedAt"],
    repository: ["projectName", "language", "health", "updatedAt"],
    workspace: ["changesetId", "runtime", "state", "updatedAt"],
    changeset: ["repositoryName", "status", "updatedAt"],
    trail: ["health", "updatedAt"],
    stack: ["baseBranch", "state", "updatedAt"],
    review: ["changesetId", "changesetTitle", "reviewer", "decision", "updatedAt"],
    evaluation: ["changesetId", "changesetTitle", "result", "updatedAt"],
    "repair-session": ["trigger", "state", "updatedAt"],
    "memory-entry": ["category", "source", "confidence", "updatedAt"],
    "pipeline-run": ["changesetId", "changesetTitle", "workflow", "result", "updatedAt"],
    "security-finding": ["resource", "scan", "severity", "updatedAt"],
    "governance-policy": ["scope", "enforcement", "policyState", "updatedAt"],
    usage: ["resource", "usage", "cost", "updatedAt"],
    setting: ["description", "scope", "state", "updatedAt"],
    unclassified: ["detail", "status", "updated"],
  };
  const numericFields: Record<string, string[]> = {
    project: ["repositoryCount"],
    trail: ["completedChangesets", "totalChangesets", "repositoryCount"],
    stack: ["changesetCount"],
    review: ["fileCount"],
    evaluation: ["checkCount", "suiteCount"],
    "repair-session": ["attempt", "maxAttempts"],
  };
  const strings = stringFields[value.kind];
  if (!strings || !strings.every((field) => isString(value[field]))) return false;
  return (numericFields[value.kind] ?? []).every((field) => typeof value[field] === "number");
}

export function migrateResourceRecords(value: unknown, page: string, fallback: ResourceRecord[]): ResourceRecord[] {
  if (!Array.isArray(value)) return fallback;
  const records: ResourceRecord[] = [];
  for (const entry of value) {
    if (isResourceRecord(entry)) {
      records.push(entry);
      continue;
    }
    const row = legacyRow(entry);
    if (!row) return fallback;
    records.push(fromLegacy(row, page));
  }
  return records;
}

export function normalizeResourceRecords(value: unknown, page: string, fallback: ResourceRecord[]): ResourceRecord[] {
  if (!Array.isArray(value)) return fallback;
  if (value.every(isResourceRecord)) return value;
  return migrateResourceRecords(value, page, fallback);
}
