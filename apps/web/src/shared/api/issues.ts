import { APIError } from "./errors";
import { request } from "./identity";

export const issueTypes = ["task", "bug", "feature"] as const;
export type IssueType = (typeof issueTypes)[number];

export type IssueState = "open" | "closed";
export type IssueStateReason = "completed" | "not_planned" | "duplicate";

export interface Label {
  id: string;
  name: string;
  description: string;
  color: string;
  created_at: string;
  updated_at?: string;
}

export interface Assignee {
  user_id: string;
  display_name?: string;
}

export type IssueProject = { id: string; number: number; name: string; repository?: string; recent?: boolean };

export interface Issue {
  custom_fields?: Record<string, string>;
  changesets?: { id: string; title: string }[];
  created_by_name?: string;
  id: string;
  number: number;
  repository: string;
  title: string;
  body: string;
  state: IssueState;
  issue_type?: IssueType;
  state_reason?: IssueStateReason;
  milestone_id?: string;
  milestone_title?: string;
  projects?: IssueProject[];
  locked: boolean;
  comments: number;
  labels: Label[];
  assignees: Assignee[];
  created_by: string;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  closed_by?: string;
}

export interface IssuePage {
  items: Issue[];
  total: number;
  open_total: number;
  closed_total: number;
  filter_options?: { authors: string[]; labels: string[]; assignees: string[]; milestones: string[] };
  limit: number;
  offset: number;
}

export interface IssueListParams {
  repository?: string;
  state?: IssueState;
  created_by?: string;
  assignee?: string;
  labels?: string;
  milestone?: string;
  since?: string;
  q?: string;
  sort?: "created" | "updated" | "comments";
  direction?: "asc" | "desc";
  limit?: number;
  offset?: number;
  include_filter_options?: boolean;
}

export interface UploadedIssueAttachment {
  id: string;
  url: string;
  name: string;
  image: boolean;
}

export interface IssueCreate {
  parent_number?: number;
  repository: string;
  title: string;
  body: string;
  issue_type?: IssueType | "";
  assignees?: string[];
  label_ids?: string[];
  milestone_id?: string;
  attachment_ids?: string[];
  project_ids?: string[];
}

export interface IssueUpdate {
  custom_fields?: Record<string, string>;
  changeset_ids?: string[];
  issue_type?: IssueType | "";
  assignees?: string[];
  label_ids?: string[];
  milestone_id?: string;
  project_ids?: string[];
  title?: string;
  body?: string;
  expected_updated_at?: string;
}

function repositoryPath(organizationID: string, owner: string, repo: string) {
  return `/api/v1/organizations/${encodeURIComponent(organizationID)}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

type ArrayResponse<T> = { items: T[] | null };

type GitHubIssueReference = { kind: "issues" | "pull"; title: string; state: "open" | "closed" | "merged" };
const githubReferenceLookups = new Map<string, Promise<GitHubIssueReference>>();

export const issuesAPI = {
  projects: async (organizationID: string, repository = "", signal?: AbortSignal) => {
    const query = repository ? `?${new URLSearchParams({ repository })}` : "";
    const { items } = await request<ArrayResponse<IssueProject>>(
      `/api/v1/organizations/${encodeURIComponent(organizationID)}/issue-projects${query}`, { signal },
    );
    return items ?? [];
  },

  createProject: (organizationID: string, name: string, repository: string) =>
    request<IssueProject>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/issue-projects`, {
      method: "POST", body: JSON.stringify({ name, repository }),
    }),

  uploadAttachment: async (organizationID: string, repository: string, file: File) => {
    // Reject oversized files before the proxy receives them. The API enforces the same limits.
    const sizeLimit = /\.(png|gif|jpe?g|svg|mp4|mov|webm)$/i.test(file.name.trim()) ? 10 << 20 : 25 << 20;
    if (file.size > sizeLimit) throw new APIError("Attachment too large", 413);
    const query = new URLSearchParams({ repository, filename: file.name });
    return request<UploadedIssueAttachment>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/issue-attachments?${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
  },

  labels: async (organizationID: string, owner: string, repo: string) => {
    const { items } = await request<ArrayResponse<{ ID: string; Name: string }>>(`${repositoryPath(organizationID, owner, repo)}/labels`);
    return (items ?? []).map(({ ID, Name }) => ({ id: ID, name: Name }));
  },

  milestones: async (organizationID: string, owner: string, repo: string) => {
    const { items } = await request<ArrayResponse<{ ID: string; Title: string }>>(`${repositoryPath(organizationID, owner, repo)}/milestones`);
    return (items ?? []).map(({ ID, Title }) => ({ id: ID, name: Title }));
  },

  list: (organizationID: string, params: IssueListParams = {}, signal?: AbortSignal) => {
    const queryParams = new URLSearchParams();
    if (params.repository) queryParams.set("repository", params.repository);
    if (params.state) queryParams.set("state", params.state);
    if (params.created_by) queryParams.set("created_by", params.created_by);
    if (params.assignee) queryParams.set("assignee", params.assignee);
    if (params.labels) queryParams.set("labels", params.labels);
    if (params.milestone) queryParams.set("milestone", params.milestone);
    if (params.since) queryParams.set("since", params.since);
    if (params.q) queryParams.set("q", params.q);
    if (params.sort) queryParams.set("sort", params.sort);
    if (params.direction) queryParams.set("direction", params.direction);
    if (params.limit !== undefined) queryParams.set("limit", String(params.limit));
    if (params.offset !== undefined) queryParams.set("offset", String(params.offset));
    if (params.include_filter_options) queryParams.set("include_filter_options", "true");

    const query = queryParams.toString();
    const url = `/api/v1/organizations/${encodeURIComponent(organizationID)}/issues${query ? `?${query}` : ""}`;
    return request<IssuePage>(url, { signal });
  },

  memberMentions: (organizationID: string, query: string, signal: AbortSignal) => {
    const params = new URLSearchParams({ q: query });
    return request<ArrayResponse<{ username: string; display_name: string }>>(
      `/api/v1/organizations/${encodeURIComponent(organizationID)}/issues/member-mentions?${params}`, { signal },
    );
  },

  references: (organizationID: string, repository: string, numbers: number[]) => {
    const query = new URLSearchParams({ repository });
    for (const number of numbers) query.append("number", String(number));
    return request<number[]>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/issues/references?${query}`, {
      signal: AbortSignal.timeout(3000),
    });
  },

  githubPullSearch: (organizationID: string, repository: string, q: string, signal: AbortSignal) => {
    const query = new URLSearchParams({ repository, q });
    return request<{ items: Array<{ number: number; title: string }> }>(
      `/api/v1/organizations/${encodeURIComponent(organizationID)}/issues/github-pull-search?${query}`, { signal });
  },
  githubReference: (organizationID: string, repository: string, number: number) => {
    const query = new URLSearchParams({ repository, number: String(number) });
    const path = `/api/v1/organizations/${encodeURIComponent(organizationID)}/issues/github-reference?${query}`;
    const existing = githubReferenceLookups.get(path);
    if (existing) return existing;
    const lookup = request<GitHubIssueReference>(path, { signal: AbortSignal.timeout(3000) })
      .finally(() => githubReferenceLookups.delete(path));
    githubReferenceLookups.set(path, lookup);
    return lookup;
  },

  get: (organizationID: string, number: number, repository: string) => {
    const queryParams = new URLSearchParams({ repository });
    return request<Issue>(
      `/api/v1/organizations/${encodeURIComponent(organizationID)}/issues/${number}?${queryParams}`
    );
  },

  create: (organizationID: string, data: IssueCreate) =>
    request<Issue>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/issues`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (organizationID: string, number: number, repository: string, data: IssueUpdate) => {
    const queryParams = new URLSearchParams({ repository });
    return request<Issue>(
      `/api/v1/organizations/${encodeURIComponent(organizationID)}/issues/${number}?${queryParams}`,
      { method: "PATCH", body: JSON.stringify(data) }
    );
  },

  close: (organizationID: string, number: number, repository: string, reason: IssueStateReason) => {
    const queryParams = new URLSearchParams({ repository });
    return request<Issue>(
      `/api/v1/organizations/${encodeURIComponent(organizationID)}/issues/${number}/close?${queryParams}`,
      { method: "POST", body: JSON.stringify({ reason }) }
    );
  },

  reopen: (organizationID: string, number: number, repository: string) => {
    const queryParams = new URLSearchParams({ repository });
    return request<Issue>(
      `/api/v1/organizations/${encodeURIComponent(organizationID)}/issues/${number}/reopen?${queryParams}`,
      { method: "POST" }
    );
  },
};
