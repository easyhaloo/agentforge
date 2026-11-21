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
  limit: number;
  offset: number;
}

export interface IssueListParams {
  repository?: string;
  state?: "open" | "closed" | "all";
  creator?: string;
  assignee?: string;
  labels?: string;
  milestone?: string;
  since?: string;
  q?: string;
  sort?: "created" | "updated" | "comments";
  direction?: "asc" | "desc";
  page?: number;
  per_page?: number;
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
  list: (organizationID: string, params: IssueListParams = {}) => {
    const queryParams = new URLSearchParams();
    if (params.repository) queryParams.set("repository", params.repository);
    if (params.state) queryParams.set("state", params.state);
    if (params.creator) queryParams.set("creator", params.creator);
    if (params.assignee) queryParams.set("assignee", params.assignee);
    if (params.labels) queryParams.set("labels", params.labels);
    if (params.milestone) queryParams.set("milestone", params.milestone);
    if (params.since) queryParams.set("since", params.since);
    if (params.q) queryParams.set("q", params.q);
    if (params.sort) queryParams.set("sort", params.sort);
    if (params.direction) queryParams.set("direction", params.direction);
    if (params.page) queryParams.set("page", String(params.page));
    if (params.per_page) queryParams.set("per_page", String(params.per_page));

    const query = queryParams.toString();
    const url = `/api/v1/organizations/${encodeURIComponent(organizationID)}/issues${query ? `?${query}` : ""}`;
    return request<IssuePage>(url);
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

  close: (organizationID: string, number: number, repository: string, state_reason: IssueStateReason) => {
    const queryParams = new URLSearchParams({ repository });
    return request<Issue>(
      `/api/v1/organizations/${encodeURIComponent(organizationID)}/issues/${number}/close?${queryParams}`,
      { method: "POST", body: JSON.stringify({ state_reason }) }
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
