// `slug` is the URL handle; the API may not return it yet, so routing falls back to `id` (see shared/routing).
export type OrganizationSummary = { id: string; slug: string; name: string; role: "owner" | "admin" | "member" | "viewer" };
export type AccountContext = { user_id: string; display_name: string; email?: string; organizations: OrganizationSummary[] };
export type OrganizationMember = { user_id: string; display_name: string; email?: string; role: string; status: string; created_at: string; updated_at: string };
export type OrganizationInvitation = { id: string; email: string; role: string; status: string; invited_by: string; expires_at: string; created_at: string };
export type MembershipAuditEvent = { id: string; actor_user_id: string; target_user_id: string; action: string; before_role: string; after_role?: string | null; before_status: string; after_status: string; created_at: string };
type Page<T> = { items: T[]; limit: number; offset: number };
export type CreatedInvitation = { invitation: OrganizationInvitation; invitation_url: string; token: string };

const API_BASE = ""; // Host-only __Host- cookies require a same-origin API reverse proxy.
export { APIError } from "./errors";
import { APIError } from "./errors";
function csrfCookie(): string {
  const prefix = "__Host-agentforge_csrf=";
  const entry = document.cookie.split("; ").find((part) => part.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : "";
}
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init.method && !["GET", "HEAD", "OPTIONS"].includes(init.method.toUpperCase())) {
    const token = csrfCookie();
    if (token) headers.set("X-CSRF-Token", token);
  }
  const response = await fetch(API_BASE + path, { ...init, headers, credentials: "include" });
  if (!response.ok) {
    // The API answers with RFC 7807 problem details. Its prose is English, so it is kept on the
    // error for the console and the interface shows a message chosen from the status instead.
    let detail: string | undefined;
    try {
      const problem = await response.json() as { detail?: string; title?: string };
      detail = problem.detail || problem.title;
    } catch { /* response may not contain JSON */ }
    throw new APIError(detail ?? `Request failed (${response.status})`, response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const accountAPI = {
  current: () => request<AccountContext>("/api/v1/me"),
};
export const organizationAPI = {
  members: (organizationID: string) => request<Page<OrganizationMember>>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/members?limit=100&offset=0`),
  updateMember: (organizationID: string, userID: string, update: { role?: string; status?: string }) =>
    request<OrganizationMember>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/members/${encodeURIComponent(userID)}`, { method: "PATCH", body: JSON.stringify(update) }),
  removeMember: (organizationID: string, userID: string) =>
    request<void>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/members/${encodeURIComponent(userID)}`, { method: "DELETE" }),
  invitations: (organizationID: string) => request<Page<OrganizationInvitation>>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/invitations?limit=100&offset=0`),
  createInvitation: (organizationID: string, email: string, role: string) =>
    request<CreatedInvitation>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/invitations`, { method: "POST", body: JSON.stringify({ email, role }) }),
  revokeInvitation: (organizationID: string, invitationID: string) =>
    request<void>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/invitations/${encodeURIComponent(invitationID)}`, { method: "DELETE" }),
  audit: (organizationID: string) => request<Page<MembershipAuditEvent>>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/membership-audit?limit=100&offset=0`),
};

export type LocalLoginResponse = {
  user_id: string;
  email: string;
  display_name: string;
};

export type RegisterResponse = {
  user_id: string;
  email: string;
  display_name: string;
};

export const authAPI = {
  logout: () => request<void>("/api/v1/auth/logout", { method: "POST" }),
  localLogin: (email: string, password: string) =>
    request<LocalLoginResponse>("/auth/local/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  registerUser: (email: string, password: string, display_name: string) =>
    request<RegisterResponse>("/auth/local/register", { method: "POST", body: JSON.stringify({ email, password, display_name }) }),
};

/** The server owns the changeset lifecycle status (ADR-003); the browser only displays it. */
export type ChangesetStatus =
  | "draft"
  | "evaluation_pending"
  | "evaluation_failed"
  | "evidence_required"
  | "review_required"
  | "in_review"
  | "changes_requested"
  | "ready_to_merge"
  | "merged";

/** The statuses the changeset list endpoint accepts as a filter. */
export const changesetStatuses: ChangesetStatus[] = [
  "draft",
  "evaluation_pending",
  "evaluation_failed",
  "evidence_required",
  "review_required",
  "in_review",
  "changes_requested",
  "ready_to_merge",
  "merged",
];

/** The filters the changeset list endpoint accepts; empty fields are not sent. */
export type ChangesetListFilters = {
  q?: string;
  repository?: string;
  status?: ChangesetStatus;
  reviewer?: string;
  limit?: number;
  offset?: number;
};

export type StoredChangeset = {
  changeset: {
    id: string;
    created_by: string;
    repository: string;
    title: string;
    revisions: Array<{ id: string; ref: string; commit_sha: string; parent_sha?: string; created_at: string }>;
    evaluations: Array<{ id: string; revision_id: string; base_sha?: string; status: string; summary: string; created_at: string }>;
    evidence: Array<{ id: string; revision_id: string; evaluation_id: string; kind: string; uri: string; sha256?: string; size?: number; status: string; created_at: string }>;
    reviews: Array<{ id: string; revision_id: string; reviewer: string; status: string; comment: string; created_at: string }>;
    merge?: { id: string; revision_id: string; actor: string; target_ref: string; commit_sha: string; created_at: string };
    audit: Array<{ sequence: number; actor: string; operation: string; target_id: string; outcome: string; at: string }>;
  };
  status: ChangesetStatus;
  version: number;
  created_at: string;
  updated_at: string;
};

/** A page of changesets plus the number of matches before paging. */
export type ChangesetPage = { items: StoredChangeset[]; total: number; limit: number; offset: number };
export type RepositoryMetadata = { organization_id: string; slug: string; default_branch: string; created_by: string; created_at: string; updated_at: string };
export type RepositoryPreviewEntry = { name: string; path: string; kind: "tree" | "file" | "symlink" | "blob"; mode: string; sha: string; size?: number };
export type RepositoryPreviewRef = { name: string; kind: "branch" | "tag"; sha: string };
export type RepositoryPreviewRefs = { repository: string; default_branch: string; resolved_commit_sha: string; items: RepositoryPreviewRef[] };
export type RepositoryPreviewTree = { repository: string; commit_sha: string; path: string; items: RepositoryPreviewEntry[] };
export type RepositoryPreviewBlob = { repository: string; commit_sha: string; blob_sha: string; path: string; encoding: "utf-8"; content: string };
export type RepositoryCommit = { sha: string; parents: string[]; author: string; authored_at: string; subject: string };
export type RepositoryCompare = { repository: string; base_sha: string; head_sha: string; patch: string };
export type RepositoryBlameLine = { line: number; commit_sha: string; author: string; authored_at: string; summary: string; content: string };
export const repositoryPreviewAPI = {
  refs: (organizationID: string, repository: string) => {
    const [owner, name] = repository.split("/");
    return request<RepositoryPreviewRefs>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/refs`);
  },
  tree: (organizationID: string, repository: string, path = "", ref = "") => {
    const [owner, name] = repository.split("/");
    const query = new URLSearchParams();
    if (path) query.set("path", path);
    if (ref) query.set("ref", ref);
    return request<RepositoryPreviewTree>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tree?${query.toString()}`);
  },
  compare: (organizationID: string, repository: string, base: string, head: string) => {
    const [owner, name] = repository.split("/");
    const query = new URLSearchParams({ base, head });
    return request<RepositoryCompare>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/compare?${query.toString()}`);
  },
  history: (organizationID: string, repository: string, ref = "", limit = 30) => {
    const [owner, name] = repository.split("/");
    const query = new URLSearchParams({ limit: String(limit) });
    if (ref) query.set("ref", ref);
    return request<{ repository: string; commit_sha: string; items: RepositoryCommit[] }>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/history?${query.toString()}`);
  },
  fileHistory: (organizationID: string, repository: string, path: string, ref = "", limit = 30) => {
    const [owner, name] = repository.split("/");
    const query = new URLSearchParams({ path, limit: String(limit) });
    if (ref) query.set("ref", ref);
    return request<{ repository: string; commit_sha: string; path: string; items: RepositoryCommit[] }>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/file-history?${query.toString()}`);
  },
  blame: (organizationID: string, repository: string, path: string, ref = "", start = 1, end = 200) => {
    const [owner, name] = repository.split("/");
    const query = new URLSearchParams({ path, start: String(start), end: String(end) });
    if (ref) query.set("ref", ref);
    return request<{ repository: string; commit_sha: string; path: string; start: number; end: number; items: RepositoryBlameLine[] }>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/blame?${query.toString()}`);
  },
  imageURL: (organizationID: string, repository: string, path: string, ref = "") => {
    const [owner, name] = repository.split("/");
    const query = new URLSearchParams({ path });
    if (ref) query.set("ref", ref);
    return `/api/v1/organizations/${encodeURIComponent(organizationID)}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/image?${query.toString()}`;
  },
  blob: (organizationID: string, repository: string, path: string, ref = "") => {
    const [owner, name] = repository.split("/");
    const query = new URLSearchParams({ path });
    if (ref) query.set("ref", ref);
    return request<RepositoryPreviewBlob>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/blob?${query.toString()}`);
  },
};
export const repositoryAPI = {
  list: (organizationID: string) => request<{items: RepositoryMetadata[]}>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/repositories`),
  register: (organizationID: string, slug: string, defaultBranch: string) =>
    request<RepositoryMetadata>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/repositories`, {method:"POST",body:JSON.stringify({slug,default_branch:defaultBranch})}),
};
export const changesetAPI = {
  get: (organizationID: string, id: string) => request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}`),
  addRevision: (organizationID: string,id: string,ref: string) => request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}/revisions`,{method:"POST",body:JSON.stringify({ref})}),
  evaluate: (organizationID: string,id: string) => request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}/evaluations`,{method:"POST",body:JSON.stringify({})}),
  attachEvidence: (organizationID: string,id: string,evaluationID: string) => request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}/evidence`,{method:"POST",body:JSON.stringify({evaluation_id:evaluationID})}),
  assignReview: (organizationID: string,id: string,reviewerID: string,comment: string) => request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}/reviews`,{method:"POST",body:JSON.stringify({reviewer_id:reviewerID,comment})}),
  decideReview: (organizationID: string,id: string,reviewID: string,approved: boolean,comment: string) => request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}/reviews/${encodeURIComponent(reviewID)}/decision`,{method:"POST",body:JSON.stringify({approved,comment})}),
  merge: (organizationID: string,id: string,targetRef: string) => request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}/merge`,{method:"POST",body:JSON.stringify({target_ref:targetRef})}),
  list: (organizationID: string, filters: ChangesetListFilters = {}) => {
    const query = new URLSearchParams();
    if (filters.q) query.set("q", filters.q);
    if (filters.repository) query.set("repository", filters.repository);
    if (filters.status) query.set("status", filters.status);
    if (filters.reviewer) query.set("reviewer", filters.reviewer);
    query.set("limit", String(filters.limit ?? 20));
    query.set("offset", String(filters.offset ?? 0));
    return request<ChangesetPage>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets?${query.toString()}`);
  },
  create: (organizationID: string, repository: string, title: string) =>
    request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets`, {
      method: "POST", body: JSON.stringify({ repository, title }),
    }),
};
