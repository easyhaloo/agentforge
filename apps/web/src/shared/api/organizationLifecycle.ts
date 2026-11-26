// Organization lifecycle API: rename/slug change, ownership transfer,
// suspend/resume, scheduled deletion, merged audit, and the read-only
// identity-provider status surfaces. All calls go through the same-origin
// request helper (CSRF included automatically).
import { request } from "./identity";

export type LifecycleStatus = "active" | "suspended" | "pending_deletion";

export type OrganizationLifecycle = {
  id: string;
  name: string;
  slug: string;
  status: LifecycleStatus;
  suspended_at?: string | null;
  suspended_reason?: string;
  deletion_scheduled_at?: string | null;
  version: number;
};

export type LifecycleAuditEvent = {
  id: string;
  actor_user_id: string;
  target_user_id?: string;
  action: string;
  detail?: unknown;
  created_at: string;
};

export type IdentityCheck = {
  name: string;
  status: "ok" | "fail" | "warn";
  detail?: string;
  error?: string;
  duration?: string;
};

export type IdentityProviderStatus = {
  id: string;
  login_url?: string;
  issuer_url?: string;
  client_id?: string;
  secret_configured: boolean;
  redirect_url?: string;
  active: boolean;
};

export type IdentityStatus = {
  ready: boolean;
  providers: IdentityProviderStatus[];
  checks: IdentityCheck[];
  app_origin?: string;
};

export type IdentityHealth = { ready: boolean; summary: string };

const org = (organizationID: string) => `/api/v1/organizations/${encodeURIComponent(organizationID)}`;

export const organizationLifecycleAPI = {
  update: (organizationID: string, update: { name?: string; slug?: string; expected_version?: number }) =>
    request<OrganizationLifecycle>(org(organizationID), { method: "PATCH", body: JSON.stringify(update) }),
  transferOwnership: (organizationID: string, userID: string) =>
    request<unknown>(`${org(organizationID)}/transfer-ownership`, { method: "POST", body: JSON.stringify({ user_id: userID }) }),
  suspend: (organizationID: string, reason: string) =>
    request<OrganizationLifecycle>(`${org(organizationID)}/suspend`, { method: "POST", body: JSON.stringify({ reason }) }),
  resume: (organizationID: string) =>
    request<OrganizationLifecycle>(`${org(organizationID)}/resume`, { method: "POST", body: JSON.stringify({}) }),
  scheduleDeletion: (organizationID: string) =>
    request<OrganizationLifecycle>(`${org(organizationID)}/deletion`, { method: "POST", body: JSON.stringify({}) }),
  cancelDeletion: (organizationID: string) =>
    request<OrganizationLifecycle>(`${org(organizationID)}/deletion`, { method: "DELETE" }),
  audit: (organizationID: string, limit = 100, offset = 0) =>
    request<{ items: LifecycleAuditEvent[]; total: number; limit: number; offset: number }>(`${org(organizationID)}/audit?limit=${limit}&offset=${offset}`),
  identityHealth: (organizationID: string) =>
    request<IdentityHealth>(`${org(organizationID)}/identity-health`),
};

export const adminIdentityAPI = {
  status: () => request<IdentityStatus>("/api/v1/admin/identity"),
  recheck: () => request<IdentityStatus>("/api/v1/admin/identity/check", { method: "POST", body: JSON.stringify({}) }),
};
