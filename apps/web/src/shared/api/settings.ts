/**
 * Settings API client for personal settings endpoints.
 * All endpoints require authentication via session cookies.
 */

import { request } from "./identity";

function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  return request<T>(`/api/v1/users/me${endpoint}`, options);
}

export interface SavedReply {
  id: string;
  title: string;
  body: string;
}

// Type definitions
export interface UserPreferences {
  theme: "light" | "dark" | "auto";
  language: "en-US" | "zh-CN";
  timezone: string;
  updated_at: string;
}

export interface UserProfile {
  user_id: string;
  username: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
  bio: string;
  location: string;
  created_at: string;
  updated_at: string;
}

export interface AuthenticationInfo {
  oidc_provider: string;
  oidc_provider_url: string;
  login_email: string;
  last_login_at: string;
}

export interface NotificationPreferences {
  inbox_participating: boolean;
  inbox_watching: boolean;
}

export interface NotificationEmailSettings {
  available: boolean;
  address: string;
  pending_address: string;
  participating: boolean;
  watching: boolean;
}

export interface SSHKey {
  key_id: string;
  title: string;
  key_type: "RSA" | "Ed25519" | "ECDSA";
  key_bits: number;
  public_key: string;
  fingerprint: string;
  created_at: string;
  last_used_at: string | null;
}

export interface Session {
  session_id: string;
  device_type: "desktop" | "mobile" | "tablet" | "unknown";
  browser: string;
  os: string;
  ip_address: string;
  location: string | null;
  created_at: string;
  last_active_at: string;
  is_current: boolean;
}

export interface AgentPreferences {
  output_verbosity: "concise" | "standard" | "verbose";
  confirmation_strategy: "always" | "batch" | "auto";
  automation_level: "conservative" | "balanced" | "aggressive";
  cross_session_memory_enabled: boolean;
  auto_evaluate_on_push: boolean;
  notify_evaluation_results: boolean;
  evaluation_strictness: "strict" | "standard" | "lenient";
  agent_review_enabled: boolean;
  agent_can_approve_low_risk: boolean;
  review_focus: {
    security: boolean;
    performance: boolean;
    code_style: boolean;
    test_coverage: boolean;
    documentation: boolean;
  };
}

/**
 * Settings API client
 */
export const settingsAPI = {
  listSavedReplies: (signal?: AbortSignal) =>
    fetchAPI<{ items: SavedReply[] }>("/saved-replies", { signal }).then(({ items }) => items),

  saveReply: ({ id, title, body }: SavedReply) =>
    fetchAPI<SavedReply>(id ? `/saved-replies/${encodeURIComponent(id)}` : "/saved-replies", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify({ title, body }),
    }),

  deleteSavedReply: (id: string) => fetchAPI<void>(`/saved-replies/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // Preferences
  getPreferences: () => fetchAPI<UserPreferences>("/preferences"),

  updatePreferences: (data: Partial<Omit<UserPreferences, "updated_at">>) =>
    fetchAPI<UserPreferences>("/preferences", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // Profile
  getProfile: () => fetchAPI<UserProfile>("/profile"),

  updateProfile: (data: Partial<Omit<UserProfile, "user_id" | "username" | "email" | "created_at" | "updated_at">>) =>
    fetchAPI<UserProfile>("/profile", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // Authentication
  getAuthenticationInfo: () => fetchAPI<AuthenticationInfo>("/authentication-info"),

  // Notifications
  getNotificationPreferences: () => fetchAPI<NotificationPreferences>("/notification-preferences"),

  updateNotificationPreferences: (data: Partial<NotificationPreferences>) =>
    fetchAPI<NotificationPreferences>("/notification-preferences", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  getNotificationEmail: (signal?: AbortSignal) => fetchAPI<NotificationEmailSettings>("/notification-email", { signal }),

  requestNotificationEmail: (address: string) => fetchAPI<NotificationEmailSettings>("/notification-email/verification", {
    method: "POST", body: JSON.stringify({ address }),
  }),

  verifyNotificationEmail: (code: string) => fetchAPI<NotificationEmailSettings>("/notification-email/verify", {
    method: "POST", body: JSON.stringify({ code }),
  }),

  updateNotificationEmail: (data: Partial<Pick<NotificationEmailSettings, "participating" | "watching">>) =>
    fetchAPI<NotificationEmailSettings>("/notification-email", { method: "PATCH", body: JSON.stringify(data) }),

  // SSH Keys
  getSSHKeys: () => fetchAPI<{ keys: SSHKey[] }>("/ssh-keys").then(result => result.keys),

  addSSHKey: (data: { title: string; public_key: string }) =>
    fetchAPI<SSHKey>("/ssh-keys", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  deleteSSHKey: (keyId: string) =>
    fetchAPI<void>(`/ssh-keys/${encodeURIComponent(keyId)}`, {
      method: "DELETE",
    }),

  // Sessions
  getSessions: () => fetchAPI<{ sessions: Session[] }>("/sessions").then(result => result.sessions),

  revokeSession: (sessionId: string) =>
    fetchAPI<void>(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    }),

  revokeAllOtherSessions: () =>
    fetchAPI<{ revoked_count: number }>("/sessions", {
      method: "DELETE",
    }),

  // Agent Preferences
  getAgentPreferences: () => fetchAPI<AgentPreferences>("/agent-preferences"),

  updateAgentPreferences: (data: Partial<AgentPreferences>) =>
    fetchAPI<AgentPreferences>("/agent-preferences", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  clearAgentMemory: () =>
    fetchAPI<{ success: boolean }>("/agent-memory/clear", {
      method: "POST",
    }),
};
