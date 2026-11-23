import { request, type RepositoryPreviewRef } from "./identity";
import type { Issue } from "./issues";

export type IssueComment = {
  id: string;
  body: string;
  author_id: string;
  created_at: string;
  edited_at?: string;
  minimized: boolean;
  minimized_reason?: string;
  version: number;
};
export type IssueEvent = { id: string; event_type: string; actor_id?: string; metadata?: { changeset_id?: string }; created_at: string };
export const reactionEmoji = { "+1": "👍", "-1": "👎", laugh: "😄", confused: "😕", heart: "❤️", hooray: "🎉", rocket: "🚀", eyes: "👀" };
export type ReactionContent = keyof typeof reactionEmoji;
export type IssueReaction = { id: string; user_id: string; content: ReactionContent };
export const lockReasons = ["off-topic", "too heated", "resolved", "spam"] as const;
export type LockReason = (typeof lockReasons)[number];

export type IssueSummary = Pick<Issue, "id" | "number" | "title" | "state">;
export type IssueRelationships = { parent: IssueSummary | null; children: IssueSummary[] };
export type IssueArtifact = { id: string; name: string; size: number; url: string };
export const reportReasons = ["spam", "abuse", "harassment", "inappropriate", "other"] as const;
export type IssueGitHubReference = { url: string; actor: string; title: string; number: number; created_at: string };
export type IssueGitHubSource = { url: string; fetched_at: string; references: IssueGitHubReference[] };
export type ReportReason = (typeof reportReasons)[number];

export function issueConversationAPI(organizationID: string, repository: string, number: number) {
  const base = `/api/v1/organizations/${encodeURIComponent(organizationID)}`;
  const query = `?${new URLSearchParams({ repository })}`;
  const issue = `/issues/${number}`;
  const comment = (id: string) => `/comments/${encodeURIComponent(id)}`;
  const reactions = (id?: string, suffix = "") => `${base}${id ? comment(id) : issue}/reactions${suffix}${id ? "" : query}`;
  return {
    githubSource: () => request<IssueGitHubSource | null>(`${base}${issue}/github-source${query}`),
    setGitHubSource: (url: string, expected: string) => request<IssueGitHubSource | null>(`${base}${issue}/github-source${query}`, {
      method: "PUT", body: JSON.stringify({ url, expected_fetched_at: expected }),
    }),
    createBranch: (name: string, branch: RepositoryPreviewRef) => request<RepositoryPreviewRef>(`${base}${issue}/branches${query}`, {
      method: "POST", body: JSON.stringify({ name, base_branch: branch.name, base_sha: branch.sha }),
    }),
    transfer: (destination: string, expected: string) => request<Issue>(`${base}${issue}/transfer${query}`, {
      method: "POST", body: JSON.stringify({ repository: destination, expected_updated_at: expected }),
    }),
    relationships: () => request<IssueRelationships>(`${base}${issue}/relationships${query}`),
    setParent: (child: number, parent?: number) => request<IssueRelationships>(`${base}/issues/${child}/parent${query}`, {
      method: parent === undefined ? "DELETE" : "PUT",
      body: parent === undefined ? undefined : JSON.stringify({ number: parent }),
    }),
    artifacts: () => request<{ artifacts: IssueArtifact[] }>(`${base}${issue}/artifacts${query}`).then(({ artifacts }) => artifacts),
    setArtifact: (id: string, linked: boolean) => request<void>(`${base}${issue}/artifacts/${encodeURIComponent(id)}${query}`, {
      method: linked ? "PUT" : "DELETE",
    }),
    report: (reason: ReportReason, details: string, commentId?: string) => request<{ id: string }>(`${base}${issue}/reports${query}`, {
      method: "POST", body: JSON.stringify({ reason, details, commentId }),
    }),
    comments: () => request<{ items: IssueComment[] | null }>(`${base}${issue}/comments${query}`).then(({ items }) => items ?? []),
    timeline: () => request<{ events: IssueEvent[] | null }>(`${base}${issue}/timeline${query}`).then(({ events }) => events ?? []),
    subscribe: (value?: boolean) => request<{ subscribed: boolean }>(`${base}${issue}/subscription${query}`, {
      method: value === undefined ? "GET" : value ? "POST" : "DELETE",
    }).then(({ subscribed }) => subscribed),
    create: (body: string) => request<IssueComment>(`${base}${issue}/comments${query}`, { method: "POST", body: JSON.stringify({ body }) }),
    update: (entry: IssueComment, body: string) => request<IssueComment>(`${base}${comment(entry.id)}`, {
      method: "PATCH", body: JSON.stringify({ body, version: entry.version }),
    }),
    remove: (id: string) => request<void>(`${base}${comment(id)}`, { method: "DELETE" }),
    minimize: (id: string, reason?: string) => request<IssueComment>(`${base}${comment(id)}/minimize`, {
      method: reason ? "POST" : "DELETE", body: reason ? JSON.stringify({ reason }) : undefined,
    }),
    lock: (reason?: LockReason) => request<Issue>(`${base}${issue}/lock${query}`, {
      method: reason ? "POST" : "DELETE", body: reason ? JSON.stringify({ reason }) : undefined,
    }),
    reactions: (id?: string) => request<{ items: IssueReaction[] | null }>(reactions(id)).then(({ items }) => items ?? []),
    react: (content: ReactionContent, id?: string) => request<IssueReaction>(reactions(id), { method: "POST", body: JSON.stringify({ content }) }),
    unreact: (reactionID: string, id?: string) => request<void>(reactions(id, `/${encodeURIComponent(reactionID)}`), { method: "DELETE" }),
  };
}
