export type OrganizationSummary = { id: string; name: string; role: "owner" | "admin" | "member" | "viewer" };
export type AccountContext = { user_id: string; display_name: string; email?: string; organizations: OrganizationSummary[] };
export type OrganizationMember = { user_id: string; display_name: string; email?: string; role: string; status: string; created_at: string; updated_at: string };
export type OrganizationInvitation = { id: string; email: string; role: string; status: string; invited_by: string; expires_at: string; created_at: string };
export type MembershipAuditEvent = { id: string; actor_user_id: string; target_user_id: string; action: string; before_role: string; after_role?: string | null; before_status: string; after_status: string; created_at: string };
type Page<T> = { items: T[]; limit: number; offset: number };
export type CreatedInvitation = { invitation: OrganizationInvitation; invitation_url: string; token: string };

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
export class APIError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "APIError"; }
}
function csrfCookie(): string {
  const prefix = "__Host-agentforge_csrf=";
  const entry = document.cookie.split("; ").find((part) => part.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : "";
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init.method && !["GET", "HEAD", "OPTIONS"].includes(init.method.toUpperCase())) {
    const token = csrfCookie();
    if (token) headers.set("X-CSRF-Token", token);
  }
  const response = await fetch(API_BASE + path, { ...init, headers, credentials: "include" });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const problem = await response.json() as { detail?: string; title?: string };
      message = problem.detail || problem.title || message;
    } catch { /* response may not contain JSON */ }
    throw new APIError(message, response.status);
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
