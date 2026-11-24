import { request } from "./identity";
import type { IssueProject, ProjectLayout } from "./issues";

export const projectStatuses = ["todo", "in_progress", "done"] as const;
export const projectPriorities = ["p0", "p1", "p2"] as const;
export const projectLayouts = ["table", "board", "roadmap"] as const;
export const projectSorts = ["manual", "title", "priority", "target_date"] as const;
export const projectGroups = ["status", "priority", "none"] as const;
export type ProjectStatus = typeof projectStatuses[number];
export type ProjectPriority = "" | typeof projectPriorities[number];
export type ProjectItemKind = "issue" | "pull_request" | "draft";
export type ProjectTemplate = "team_backlog" | "release_plan";

export type ProjectView = {
  id: string;
  name: string;
  layout: ProjectLayout;
  filter: string;
  sort: typeof projectSorts[number];
  group: typeof projectGroups[number];
};

export type ProjectAutoAdd = {
  repository: string;
  kind: "issue" | "pull_request";
  label_id?: string;
};

export type ProjectWorkflows = {
  item_added: ProjectStatus;
  issue_closed: ProjectStatus | "";
  pull_request_closed: ProjectStatus | "";
  pull_request_merged: ProjectStatus | "";
  auto_archive_days?: number;
  auto_add?: ProjectAutoAdd;
};

export type ProjectWorkflowRun = {
  id: string;
  rule: "issue_closed" | "pull_request_closed" | "pull_request_merged" | "auto_archive" | "auto_add";
  item_count: number;
  occurred_at: string;
};

export type Project = IssueProject & {
  description?: string;
  readme?: string;
  closed?: boolean;
  version: number;
  updated_at?: string;
  repositories?: string[];
  views?: ProjectView[];
  workflows: ProjectWorkflows;
};

export type ProjectItem = {
  id: string;
  kind: ProjectItemKind;
  title: string;
  draft_body?: string;
  repository?: string;
  number?: number;
  source_id?: string;
  status: ProjectStatus | "";
  priority?: ProjectPriority;
  start_date?: string;
  target_date?: string;
  iteration?: string;
  archived: boolean;
  field_values?: Record<string, string | number>;
  version: number;
};

export type ProjectStatusDay = { date: string } & Record<ProjectStatus, number>;

export const projectUpdateStatuses = ["on_track", "at_risk", "off_track"] as const;
export type ProjectUpdateInput = {
  status: typeof projectUpdateStatuses[number];
  body: string;
  start_date?: string;
  target_date?: string;
};
export type ProjectProgress = ProjectUpdateInput & { id: string; author_name: string; created_at: string };

type ProjectUpdate = Partial<Pick<Project, "name" | "description" | "readme" | "closed" | "default_repository" | "repositories" | "views" | "workflows">> & { version: number };
export type ProjectItemUpdate = Partial<Pick<ProjectItem, "title" | "draft_body" | "status" | "priority" | "start_date" | "target_date" | "iteration" | "archived">> & { version: number };
export type ProjectItemPlacement = { status?: ProjectStatus; priority?: ProjectPriority };
export type NewProjectItem = ProjectItemPlacement & (
  { kind: "draft"; title: string; draft_body?: string } | { kind: "issue"; repository: string; number: number } | { kind: "pull_request"; repository: string; source_id: string }
);

function projectURL(orgID: string, number?: number | string) {
  const base = `/api/v1/organizations/${encodeURIComponent(orgID)}/issue-projects`;
  return number === undefined ? base : `${base}/${encodeURIComponent(number)}`;
}

function itemURL(orgID: string, number: number, itemID: string) {
  return `${projectURL(orgID, number)}/items/${encodeURIComponent(itemID)}`;
}

export const projectsAPI = {
  async list(orgID: string, repository = "", signal?: AbortSignal) {
    const query = repository ? `?${new URLSearchParams({ linked_repository: repository })}` : "";
    const response = await request<{ items: Project[] }>(`${projectURL(orgID)}${query}`, { signal });
    return response.items ?? [];
  },
  create: (orgID: string, input: { name: string; layout: ProjectLayout; default_repository?: string; repositories?: string[]; template?: ProjectTemplate }) =>
    request<Project>(projectURL(orgID), { method: "POST", body: JSON.stringify(input) }),
  get: (orgID: string, number: string, signal?: AbortSignal) => request<Project>(projectURL(orgID, number), { signal }),
  update: (orgID: string, number: number, input: ProjectUpdate) =>
    request<Project>(projectURL(orgID, number), { method: "PATCH", body: JSON.stringify(input) }),
  async workflowRuns(orgID: string, number: number, signal?: AbortSignal) {
    const response = await request<{ items: ProjectWorkflowRun[] }>(`${projectURL(orgID, number)}/workflow-runs`, { signal });
    return response.items ?? [];
  },
  remove: (orgID: string, number: number, version: number) =>
    request<void>(`${projectURL(orgID, number)}?version=${version}`, { method: "DELETE" }),
  async statusHistory(orgID: string, number: number, signal?: AbortSignal) {
    const response = await request<{ items: ProjectStatusDay[] }>(`${projectURL(orgID, number)}/status-history`, { signal });
    return response.items;
  },
  async updates(orgID: string, number: number, signal?: AbortSignal) {
    const response = await request<{ items: ProjectProgress[] }>(`${projectURL(orgID, number)}/updates`, { signal });
    return response.items ?? [];
  },
  publishUpdate: (orgID: string, number: number, input: ProjectUpdateInput) =>
    request<ProjectProgress>(`${projectURL(orgID, number)}/updates`, { method: "POST", body: JSON.stringify(input) }),
  async items(orgID: string, number: number, archived = false, signal?: AbortSignal) {
    const query = archived ? "?archived=true" : "";
    const response = await request<{ items: ProjectItem[] }>(`${projectURL(orgID, number)}/items${query}`, { signal });
    return response.items ?? [];
  },
  addItem: (orgID: string, number: number, input: NewProjectItem) =>
    request<ProjectItem>(`${projectURL(orgID, number)}/items`, { method: "POST", body: JSON.stringify(input) }),
  updateItem: (orgID: string, number: number, itemID: string, input: ProjectItemUpdate) =>
    request<ProjectItem>(itemURL(orgID, number, itemID), { method: "PATCH", body: JSON.stringify(input) }),
  removeItem: (orgID: string, number: number, itemID: string, version: number) =>
    request<void>(`${itemURL(orgID, number, itemID)}?version=${version}`, { method: "DELETE" }),
  convertItem: (orgID: string, number: number, itemID: string, repository: string, version: number) =>
    request<ProjectItem>(`${itemURL(orgID, number, itemID)}/convert`, { method: "POST", body: JSON.stringify({ repository, version }) }),
};
