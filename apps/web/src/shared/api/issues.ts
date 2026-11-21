import { request } from "./identity";

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
}

export interface Issue {
  id: string;
  number: number;
  repository: string;
  title: string;
  body: string;
  state: IssueState;
  state_reason?: IssueStateReason;
  milestone_id?: string;
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

export interface IssueCreate {
  repository: string;
  title: string;
  body: string;
  assignees?: string[];
  labels?: string[];
}

export interface IssueUpdate {
  title?: string;
  body?: string;
  milestone_id?: string;
}

export const issuesAPI = {
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

  get: (organizationID: string, number: number, repository: string, signal?: AbortSignal) => {
    const queryParams = new URLSearchParams({ repository });
    return request<Issue>(
      `/api/v1/organizations/${encodeURIComponent(organizationID)}/issues/${number}?${queryParams}`, { signal },
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
