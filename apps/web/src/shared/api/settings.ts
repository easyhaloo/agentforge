/**
 * Settings API client for personal settings endpoints.
 * All endpoints require authentication via session cookies.
 */

import { APIError } from "./errors";

const BASE_URL = "/api/v1/users/me";

/**
 * Base fetch wrapper with credentials and error handling
 */
async function fetchAPI<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    credentials: "include", // Send session cookie
  });

  if (!response.ok) {
    // The status is what the interface shows a message for; the API's English prose stays here.
    let detail: string | undefined;
    try {
      const problem = await response.json() as { detail?: string; title?: string; message?: string };
      detail = problem.detail || problem.title || problem.message;
    } catch { /* response may not contain JSON */ }
    throw new APIError(detail ?? `Request failed (${response.status})`, response.status, detail);
  }

  return response.json();
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
  email_notifications: {
    evaluation_complete: boolean;
    review_assigned: boolean;
    changeset_status: boolean;
    org_invitation: boolean;
  };
  web_push_enabled: boolean;
  notification_frequency: "real-time" | "hourly" | "daily";
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
  // Preferences
  getPreferences: () => fetchAPI<UserPreferences>("/preferences"),

  updatePreferences: (data: Partial<Omit<UserPreferences, "updated_at">>) =>
    fetchAPI<UserPreferences>("/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // Profile
  getProfile: () => fetchAPI<UserProfile>("/profile"),

  updateProfile: (data: Partial<Omit<UserProfile, "user_id" | "username" | "email" | "created_at" | "updated_at">>) =>
    fetchAPI<UserProfile>("/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // Authentication
  getAuthenticationInfo: () => fetchAPI<AuthenticationInfo>("/authentication-info"),

  // Notifications
  getNotificationPreferences: () => fetchAPI<NotificationPreferences>("/notification-preferences"),

  updateNotificationPreferences: (data: Partial<NotificationPreferences>) =>
    fetchAPI<NotificationPreferences>("/notification-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // SSH Keys
  getSSHKeys: () => fetchAPI<SSHKey[]>("/ssh-keys"),

  addSSHKey: (data: { title: string; public_key: string }) =>
    fetchAPI<SSHKey>("/ssh-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  deleteSSHKey: (keyId: string) =>
    fetchAPI<{ success: boolean }>(`/ssh-keys/${keyId}`, {
      method: "DELETE",
    }),

  // Sessions
  getSessions: () => fetchAPI<Session[]>("/sessions"),

  revokeSession: (sessionId: string) =>
    fetchAPI<{ success: boolean }>(`/sessions/${sessionId}`, {
      method: "DELETE",
    }),

  revokeAllOtherSessions: () =>
    fetchAPI<{ success: boolean; revoked_count: number }>("/sessions", {
      method: "DELETE",
    }),

  // Agent Preferences
  getAgentPreferences: () => fetchAPI<AgentPreferences>("/agent-preferences"),

  updateAgentPreferences: (data: Partial<AgentPreferences>) =>
    fetchAPI<AgentPreferences>("/agent-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  clearAgentMemory: () =>
    fetchAPI<{ success: boolean }>("/agent-memory/clear", {
      method: "POST",
    }),
};
