export type ResourceRow = {
  id: string;
  name: string;
  detail: string;
  status: string;
  updated: string;
  owner: string;
};

export type ProjectRecord = {
  kind: "project";
  id: string;
  name: string;
  description: string;
  repositoryCount: number;
  lifecycle: string;
  updatedAt: string;
  owner: string;
};

export type RepositoryRecord = {
  kind: "repository";
  id: string;
  name: string;
  projectName: string;
  language: string;
  health: string;
  updatedAt: string;
  owner: string;
};

export type WorkspaceRecord = {
  kind: "workspace";
  id: string;
  name: string;
  changesetId: string;
  runtime: string;
  state: string;
  updatedAt: string;
  owner: string;
};

export type GenericResourceRecord = ResourceRow & { kind: "resource" };
export type ResourceRecord = ProjectRecord | RepositoryRecord | WorkspaceRecord | GenericResourceRecord;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function legacyRow(value: unknown): ResourceRow | null {
  if (!isRecord(value)) return null;
  const fields = ["id", "name", "detail", "status", "updated", "owner"] as const;
  const values = fields.map((field) => value[field]);
  if (values.some((field) => typeof field !== "string")) return null;
  const [id, name, detail, status, updated, owner] = values as [string, string, string, string, string, string];
  return { id, name, detail, status, updated, owner };
}

export function toResourceRow(record: ResourceRecord): ResourceRow {
  switch (record.kind) {
    case "project":
      return { id: record.id, name: record.name, detail: `${record.repositoryCount} repositories · ${record.description}`, status: record.lifecycle, updated: record.updatedAt, owner: record.owner };
    case "repository":
      return { id: record.id, name: record.name, detail: `Project ${record.projectName} · ${record.language}`, status: record.health, updated: record.updatedAt, owner: record.owner };
    case "workspace":
      return { id: record.id, name: record.name, detail: `${record.changesetId} · ${record.runtime}`, status: record.state, updated: record.updatedAt, owner: record.owner };
    case "resource":
      return { id: record.id, name: record.name, detail: record.detail, status: record.status, updated: record.updated, owner: record.owner };
  }
}

function toProjectRecord(row: ResourceRow): ProjectRecord {
  const match = row.detail.match(/^(\d+) repositories · (.+)$/);
  return { kind: "project", id: row.id, name: row.name, repositoryCount: match ? Number(match[1]) : 0, description: match?.[2] ?? row.detail, lifecycle: row.status, updatedAt: row.updated, owner: row.owner };
}

function toRepositoryRecord(row: ResourceRow): RepositoryRecord {
  const match = row.detail.match(/^Project (.+) · (.+)$/);
  return { kind: "repository", id: row.id, name: row.name, projectName: match?.[1] ?? "Unassigned", language: match?.[2] ?? "Unknown", health: row.status, updatedAt: row.updated, owner: row.owner };
}

function toWorkspaceRecord(row: ResourceRow): WorkspaceRecord {
  const separator = row.detail.indexOf(" · ");
  return { kind: "workspace", id: row.id, name: row.name, changesetId: separator >= 0 ? row.detail.slice(0, separator) : "Unlinked", runtime: separator >= 0 ? row.detail.slice(separator + 3) : row.detail, state: row.status, updatedAt: row.updated, owner: row.owner };
}

export function migrateResourceRecords(value: unknown, page: string, fallback: ResourceRecord[]): ResourceRecord[] {
  if (!Array.isArray(value)) return fallback;
  const rows = value.map(legacyRow);
  if (rows.some((row) => row === null)) return fallback;
  return (rows as ResourceRow[]).map((row): ResourceRecord => {
    if (page === "Projects") return toProjectRecord(row);
    if (page === "Repositories") return toRepositoryRecord(row);
    if (page === "Workspaces") return toWorkspaceRecord(row);
    return { ...row, kind: "resource" };
  });
}

export function isResourceRecord(value: unknown): value is ResourceRecord {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return false;
  if (value.kind === "project") {
    return typeof value.description === "string" && typeof value.repositoryCount === "number" &&
      typeof value.lifecycle === "string" && typeof value.updatedAt === "string" && typeof value.owner === "string";
  }
  if (value.kind === "repository") {
    return typeof value.projectName === "string" && typeof value.language === "string" &&
      typeof value.health === "string" && typeof value.updatedAt === "string" && typeof value.owner === "string";
  }
  if (value.kind === "workspace") {
    return typeof value.changesetId === "string" && typeof value.runtime === "string" &&
      typeof value.state === "string" && typeof value.updatedAt === "string" && typeof value.owner === "string";
  }
  return value.kind === "resource" && legacyRow(value) !== null;
}

export function normalizeResourceRecords(value: unknown, page: string, fallback: ResourceRecord[]): ResourceRecord[] {
  if (!Array.isArray(value)) return fallback;
  if (value.every(isResourceRecord)) return value;
  return migrateResourceRecords(value, page, fallback);
}
