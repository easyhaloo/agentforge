import type { components, operations } from "./pipeline-contract";

// `slug` is the URL handle; the API may not return it yet, so routing falls back to `id` (see shared/routing).
export type OrganizationSummary = { id: string; slug: string; name: string; personal?: boolean; role: "owner" | "admin" | "member" | "viewer" };
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
    // error for diagnostics and the interface uses a translated message keyed by title or status.
    let detail: string | undefined;
    let title: string | undefined;
    try {
      const problem = await response.json() as { detail?: string; title?: string };
      title = problem.title;
      detail = problem.detail || title;
    } catch { /* response may not contain JSON */ }
    throw new APIError(detail ?? `Request failed (${response.status})`, response.status, detail, title);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const accountAPI = {
  current: () => request<AccountContext>("/api/v1/me"),
};
export const organizationAPI = {
  members: (organizationID: string, offset = 0) => request<Page<OrganizationMember>>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/members?limit=100&offset=${offset}`),
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
export type ChangesetListFilters = { state?: "open" | "closed";
  q?: string;
  repository?: string;
  status?: ChangesetStatus;
  reviewer?: string;
  limit?: number;
  offset?: number;
};

export type PullRequestComment = {
  id: string;
  author: string;
  body: string;
  created_at: string;
  revision_id?: string;
  path?: string;
  side?: "left" | "right";
  line?: number;
  resolved_by?: string;
  resolved_at?: string;
};

export type PullRequestMetadata = {
  base_branch: string;
  source_branch: string;
  description: string;
  draft: boolean;
  closed: boolean;
  comments: PullRequestComment[];
};

export type StoredChangeset = {
  changeset: {
    id: string;
    created_by: string;
    repository: string;
    title: string;
    revisions: Array<{ id: string; ref: string; commit_sha: string; parent_sha?: string; base_sha?: string; created_at: string }>;
    evaluations: Array<{ id: string; revision_id: string; base_sha?: string; status: string; summary: string; created_at: string }>;
    evidence: Array<{ id: string; revision_id: string; evaluation_id: string; kind: string; uri: string; sha256?: string; size?: number; status: string; created_at: string }>;
    reviews: Array<{ id: string; revision_id: string; reviewer: string; status: string; comment: string; created_at: string }>;
    merge?: { id: string; revision_id: string; actor: string; target_ref: string; commit_sha: string; created_at: string };
    audit: Array<{ sequence: number; actor: string; operation: string; target_id: string; outcome: string; at: string }>;
    pull_request?: PullRequestMetadata;
  };
  status: ChangesetStatus;
  version: number;
  created_at: string;
  updated_at: string;
};

/** A page of changesets plus the number of matches before paging. */
export type ChangesetPage = { items: StoredChangeset[]; total: number; limit: number; offset: number };
export type RepositoryVisibility = "public" | "private";
export type RefNamePattern = {
  operator: "starts_with" | "ends_with" | "contains" | "regex";
  pattern: string;
  negate?: boolean;
  name?: string;
};
export type RepositoryRefRule = {
  name: string;
  target: "branch" | "tag";
  enabled: boolean;
  include: string[];
  exclude: string[];
  restrict_creation: boolean;
  restrict_update: boolean;
  restrict_deletion: boolean;
  block_force_push: boolean;
  require_pull_request?: boolean;
  required_review_thread_resolution?: boolean;
  allowed_merge_methods?: PullRequestMergeMethod[];
  require_merge_queue?: boolean;
  merge_queue_method?: "merge" | "squash" | "rebase";
  require_linear_history?: boolean;
  name_patterns?: RefNamePattern[];
  required_workflows?: { pipeline_ids: string[]; strict: boolean; skip_creation: boolean };
};
export type RepositoryMergeMessageFormat = "default" | "title" | "description";
type RepositoryMergeMethods = {
  allow_merge_commit?: boolean;
  allow_squash_merge?: boolean;
  allow_rebase_merge?: boolean;
  merge_commit_message_format?: RepositoryMergeMessageFormat;
  squash_commit_message_format?: RepositoryMergeMessageFormat | "commits";
};
export type RepositoryMetadata = RepositoryMergeMethods & { web_commit_signoff_required?: boolean; delete_merged_branches?: boolean; suggest_branch_update?: boolean; ref_rules?: RepositoryRefRule[]; is_template?: boolean; push_ref_limit?: number; protected_refs?: string[]; actions_disabled?: boolean; actions_retention_days?: number; issues_disabled?: boolean; auto_close_issues_disabled?: boolean; visibility?: RepositoryVisibility; fork?: boolean; organization_id: string; slug: string; default_branch: string; description?: string; created_by: string; created_at: string; updated_at: string };
export type PullRequestMergeMethod = "merge" | "squash" | "rebase";
export type RepositorySettings = RepositoryMetadata & {
  hosting_kind: "hosted" | "registered";
  pull_request_merge_methods?: PullRequestMergeMethod[];
  pull_request_requires_conversation_resolution?: boolean;
};
export type RepositoryPreviewEntry = { name: string; path: string; kind: "tree" | "file" | "symlink" | "blob"; mode: string; sha: string; size?: number };
export type RepositoryPreviewRef = { name: string; kind: "branch" | "tag"; sha: string };
export type RepositoryPreviewRefs = RepositoryMergeMethods & { web_commit_signoff_required?: boolean; delete_merged_branches?: boolean; suggest_branch_update?: boolean; issues_disabled?: boolean; auto_close_issues_disabled?: boolean; description?: string; is_template?: boolean; push_ref_limit?: number; protected_refs?: string[]; updated_at?: string; hosting_kind?: "hosted" | "registered"; git_credentials_available?: boolean; repository: string; default_branch: string; resolved_commit_sha: string; items: RepositoryPreviewRef[] };
export type RepositoryPreviewTree = { repository: string; commit_sha: string; path: string; items: RepositoryPreviewEntry[] };
export type RepositoryPreviewBlob = { repository: string; commit_sha: string; blob_sha: string; path: string; encoding: "utf-8"; content: string };
export type RepositoryCommit = { sha: string; parents: string[]; author: string; authored_at: string; subject: string };
export type PullRequestComparison = RepositoryCompare & { commits: RepositoryCommit[]; commits_truncated: boolean };
export type PullBranchMethod = "merge" | "rebase";
export type PullRequestRequiredWorkflows = {
  branch_update?: { base_sha: string; methods: PullBranchMethod[]; signoff_required: boolean };
  revision_id: string;
  checks: Array<{ pipeline_id: string; name: string; status: "passed" | "waiting" | "behind" | "source_moved" }>;
};
export type RepositoryCompare = { repository: string; base_sha: string; head_sha: string; patch: string };
export type RepositoryBlameLine = { line: number; commit_sha: string; author: string; authored_at: string; summary: string; content: string };
export type GitCredential = { id: string; username: string; token: string; expires_at: string };
export type GitCredentialSummary = { id: string; scope: "read" | "write"; expires_at: string };
export const repositoryGitAPI = {
  listCredentials: (organizationID: string, repository: string, signal: AbortSignal) =>
    request<{ items: GitCredentialSummary[] }>(`${repositoryBase(organizationID, repository)}/git-credentials`, { signal }),
  createCredential: (organizationID: string, repository: string, scope: "read" | "write") =>
    request<GitCredential>(`${repositoryBase(organizationID, repository)}/git-credentials`, { method: "POST", body: JSON.stringify({ scope }) }),
  revokeCredential: (organizationID: string, repository: string, credentialID: string) =>
    request<void>(`${repositoryBase(organizationID, repository)}/git-credentials/${encodeURIComponent(credentialID)}`, { method: "DELETE" }),
};

export const repositoryPreviewAPI = {
  commitIssues: (organizationID: string, repository: string, sha: string, signal?: AbortSignal) =>
    request<{ items: number[] }>(`${repositoryBase(organizationID, repository)}/commit-issues?${new URLSearchParams({ ref: sha })}`, { signal }),
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
  compareBranches: (organizationID: string, repository: string, base: string, head: string) => {
    const [owner, name] = repository.split("/");
    const query = new URLSearchParams({ base: `refs/heads/${base}`, head: `refs/heads/${head}`, mode: "merge-base", include_commits: "true" });
    return request<PullRequestComparison>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/compare?${query}`);
  },
  history: (organizationID: string, repository: string, ref = "", limit = 30, signal?: AbortSignal) => {
    const [owner, name] = repository.split("/");
    const query = new URLSearchParams({ limit: String(limit) });
    if (ref) query.set("ref", ref);
    return request<{ repository: string; commit_sha: string; items: RepositoryCommit[] }>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/history?${query.toString()}`, { signal });
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
export type RepositorySummary = RepositoryMetadata & {
  git?: { branch_count: number; last_commit_at?: string; language?: string };
  activity?: { changeset_count: number; action_count: number };
};
export type RepositoryAction = components["schemas"]["RepositoryAction"];

export const repositoryAPI = {
  list: (organizationID: string, signal?: AbortSignal) => request<{items: RepositoryMetadata[]}>(repositoryBase(organizationID), { signal }),
  summaries: (organizationID: string) => request<{items: RepositorySummary[]}>(`${repositoryBase(organizationID)}?details=1`),
  register: (organizationID: string, slug: string, defaultBranch: string, metadata: Pick<RepositoryMetadata, "visibility" | "fork"> = {}) =>
    request<RepositoryMetadata>(repositoryBase(organizationID), {method:"POST",body:JSON.stringify({slug,default_branch:defaultBranch,...metadata})}),
  create: (organizationID: string, slug: string, description: string, initialize: { readme: boolean; gitignore: string; license: string } | { template: string; include_all_branches: boolean }) =>
    request<RepositoryMetadata>(repositoryBase(organizationID), {
      method: "POST", body: JSON.stringify({ slug, default_branch: "main", description, initialize }),
    }),
  actions: (organizationID: string, repository: string, filters: string, signal?: AbortSignal) =>
    request<operations["listRepositoryActions"]["responses"][200]["content"]["application/json"]>(`${repositoryBase(organizationID, repository)}/actions?${filters}`, { signal }),
  workflows: (organizationID: string, repository: string, signal?: AbortSignal) =>
    request<operations["listRepositoryWorkflows"]["responses"][200]["content"]["application/json"]>(`${repositoryBase(organizationID, repository)}/actions/workflows`, { signal }),
  settings: (organizationID: string, repository: string, signal?: AbortSignal, targetBranch?: string) =>
    request<RepositorySettings>(`${repositoryBase(organizationID, repository)}/settings${targetBranch ? `?${new URLSearchParams({ target_branch: targetBranch })}` : ""}`, { signal }),
  updateGeneralSettings: (organizationID: string, repository: string, settings: RepositoryMergeMethods & Pick<RepositoryMetadata, "description" | "is_template" | "push_ref_limit" | "protected_refs" | "actions_disabled" | "actions_retention_days" | "delete_merged_branches" | "suggest_branch_update" | "web_commit_signoff_required" | "issues_disabled" | "auto_close_issues_disabled" | "ref_rules" | "updated_at">) =>
    request<RepositorySettings>(`${repositoryBase(organizationID, repository)}/settings`, {
      method: "PATCH", body: JSON.stringify(settings),
    }),
  updateDefaultBranch: (organizationID: string, repository: string, defaultBranch: string, previousBranch: string) =>
    request<void>(`${repositoryBase(organizationID, repository)}/settings`, {
      method: "PATCH", body: JSON.stringify({ default_branch: defaultBranch, previous_branch: previousBranch }),
    }),
};

function repositoryBase(organizationID: string, repository?: string) {
  const base = `/api/v1/organizations/${encodeURIComponent(organizationID)}/repositories`;
  return repository ? `${base}/${repository.split("/").map(encodeURIComponent).join("/")}` : base;
}
export type WorkspaceStatus = "active" | "expired" | "closed";
export type Workspace = {
  id: string;
  organization_id: string;
  repository: string;
  owner_id: string;
  base_commit_sha: string;
  base_ref: string;
  status: WorkspaceStatus;
  expires_at: string;
  created_at: string;
  updated_at: string;
};
export type WorkspaceTreeEntry = { name: string; path: string; kind: string; source: "base" | "workspace"; version?: number };
export type WorkspaceFile = { workspace_id: string; path: string; content: string; sha256: string; version: number; source: "base" | "workspace" };
export type WorkspaceDiffEntry = { path: string; status: "added" | "modified"; base_blob_sha?: string; workspace_sha256: string; version: number };
export type WorkspaceDiff = { workspace_id: string; base_commit_sha: string; items: WorkspaceDiffEntry[]; total: number };
export const workspaceAPI = {
  create: (organizationID: string, repository: string, baseRef = "") => {
    const [owner, name] = repository.split("/");
    return request<{ workspace: Workspace; web_commit_signoff_required?: boolean }>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/workspaces`, {
      method: "POST", body: JSON.stringify(baseRef ? { base_ref: baseRef } : {}),
    });
  },
  get: (organizationID: string, workspaceID: string) =>
    request<{ workspace: Workspace }>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/workspaces/${encodeURIComponent(workspaceID)}`),
  tree: (organizationID: string, workspaceID: string, path = "") => {
    const query = new URLSearchParams();
    if (path) query.set("path", path);
    return request<{ workspace_id: string; base_commit_sha: string; path: string; items: WorkspaceTreeEntry[] }>(
      `/api/v1/organizations/${encodeURIComponent(organizationID)}/workspaces/${encodeURIComponent(workspaceID)}/tree?${query.toString()}`,
    );
  },
  diff: (organizationID: string, workspaceID: string) =>
    request<WorkspaceDiff>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/workspaces/${encodeURIComponent(workspaceID)}/diff`),
  createChangeset: (organizationID: string, workspaceID: string, title: string, signoff?: boolean) =>
    request<{ changeset: StoredChangeset; workspace_id: string; base_commit_sha: string; revision_commit_sha: string }>(
      `/api/v1/organizations/${encodeURIComponent(organizationID)}/workspaces/${encodeURIComponent(workspaceID)}/changesets`,
      { method: "POST", body: JSON.stringify({ title, signoff }) },
    ),
  readFile: (organizationID: string, workspaceID: string, path: string) =>
    request<WorkspaceFile>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/workspaces/${encodeURIComponent(workspaceID)}/files?${new URLSearchParams({ path }).toString()}`),
  writeFile: (organizationID: string, workspaceID: string, path: string, content: string, expectedVersion: number) =>
    request<WorkspaceFile>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/workspaces/${encodeURIComponent(workspaceID)}/files`, {
      method: "PUT", body: JSON.stringify({ path, content, expected_version: expectedVersion }),
    }),
};

export const changesetAPI = {
  saveFile: (organizationID: string, id: string, input: { path: string; base_commit_sha: string; base_blob_sha: string; content: string; signoff?: boolean }) => request<{ changeset: StoredChangeset; path: string; branch: string; commit_sha: string; blob_sha: string }>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}/files`, { method: "PUT", body: JSON.stringify(input) }),

  get: (organizationID: string, id: string) => request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}`),
  addRevision: (organizationID: string,id: string,ref: string) => request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}/revisions`,{method:"POST",body:JSON.stringify({ref})}),
  evaluate: (organizationID: string,id: string) => request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}/evaluations`,{method:"POST",body:JSON.stringify({})}),
  attachEvidence: (organizationID: string,id: string,evaluationID: string) => request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}/evidence`,{method:"POST",body:JSON.stringify({evaluation_id:evaluationID})}),
  assignReview: (organizationID: string,id: string,reviewerID: string,comment: string) => request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}/reviews`,{method:"POST",body:JSON.stringify({reviewer_id:reviewerID,comment})}),
  decideReview: (organizationID: string,id: string,reviewID: string,approved: boolean,comment: string) => request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}/reviews/${encodeURIComponent(reviewID)}/decision`,{method:"POST",body:JSON.stringify({approved,comment})}),
  merge: (organizationID: string,id: string,targetRef: string, mergeMethod?: PullRequestMergeMethod) => request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}/merge`,{method:"POST",body:JSON.stringify({target_ref:targetRef, merge_method:mergeMethod})}),
  list: (organizationID: string, filters: ChangesetListFilters = {}, signal?: AbortSignal) => {
    const query = new URLSearchParams();
    if (filters.q) query.set("q", filters.q);
    if (filters.repository) query.set("repository", filters.repository);
    if (filters.status) query.set("status", filters.status);
    if (filters.state) query.set("state", filters.state);
    if (filters.reviewer) query.set("reviewer", filters.reviewer);
    query.set("limit", String(filters.limit ?? 20));
    query.set("offset", String(filters.offset ?? 0));
    return request<ChangesetPage>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets?${query.toString()}`, { signal });
  },
  create: (organizationID: string, repository: string, title: string) =>
    request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets`, {
      method: "POST", body: JSON.stringify({ repository, title }),
    }),
  createPullRequest: (organizationID: string, repository: string, title: string, baseBranch: string, sourceBranch: string, expectedHeadSHA: string, description: string, draft: boolean, issueNumber?: number) =>
    request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets`, {
      method: "POST", body: JSON.stringify({ repository, title, base_branch: baseBranch, source_branch: sourceBranch, expected_head_sha: expectedHeadSHA, description, draft, issue_number: issueNumber }),
    }),
  updatePullRequestTitle: (organizationID: string, id: string, title: string, version: number) =>
    request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}/pull-request/title`, {
      method: "PATCH", body: JSON.stringify({ title, version }),
    }),
  updatePullRequestState: (organizationID: string, id: string, action: "ready" | "draft" | "close" | "reopen") =>
    request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}/pull-request/state`, {
      method: "POST", body: JSON.stringify({ action }),
    }),
  addPullRequestComment: (organizationID: string, id: string, body: string, revisionID?: string, path?: string, side?: "left" | "right", line?: number) =>
    request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}/pull-request/comments`, {
      method: "POST", body: JSON.stringify({ body, revision_id: revisionID, path, side, line }),
    }),
  setPullRequestCommentResolution: (organizationID: string, id: string, commentID: string, resolved: boolean) =>
    request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}/pull-request/comments/${encodeURIComponent(commentID)}/resolution`, {
      method: "PATCH", body: JSON.stringify({ resolved }),
    }),
  getComparison: (organizationID: string, id: string) =>
    request<PullRequestComparison>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}/comparison`),
  updatePullBranch: (organizationID: string, id: string, input: { revision_id: string; base_sha: string; method: PullBranchMethod; signoff: boolean }) =>
    request<StoredChangeset>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}/pull-request/update-branch`, { method: "POST", body: JSON.stringify(input) }),
  getRequiredWorkflows: (organizationID: string, id: string, signal: AbortSignal) =>
    request<PullRequestRequiredWorkflows>(`/api/v1/organizations/${encodeURIComponent(organizationID)}/changesets/${encodeURIComponent(id)}/pull-request/required-workflows`, { signal, cache: "no-store" }),
};
