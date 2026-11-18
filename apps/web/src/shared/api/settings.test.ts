import { afterEach, describe, expect, it, vi } from "vitest";
import { settingsAPI } from "./settings";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("settings API client", () => {
  describe("preferences API", () => {
    it("fetches user preferences with credentials", async () => {
      const preferences = {
        theme: "dark" as const,
        language: "en-US" as const,
        timezone: "America/New_York",
        updated_at: "2024-01-15T10:00:00Z",
      };
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(preferences), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await settingsAPI.getPreferences();

      expect(result).toEqual(preferences);
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/users/me/preferences",
        expect.objectContaining({ credentials: "include" })
      );
    });

    it("updates user preferences with PATCH request", async () => {
      const updated = {
        theme: "light" as const,
        language: "zh-CN" as const,
        timezone: "Asia/Shanghai",
        updated_at: "2024-01-15T11:00:00Z",
      };
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(updated), { status: 200 })
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await settingsAPI.updatePreferences({
        theme: "light",
        language: "zh-CN",
      });

      expect(result).toEqual(updated);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/v1/users/me/preferences");
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(String(init.body))).toEqual({
        theme: "light",
        language: "zh-CN",
      });
    });
  });

  describe("profile API", () => {
    it("fetches user profile", async () => {
      const profile = {
        user_id: "user-123",
        username: "testuser",
        display_name: "Test User",
        email: "test@example.com",
        avatar_url: null,
        bio: "Hello world",
        location: "San Francisco",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-15T10:00:00Z",
      };
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(profile), { status: 200 })
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await settingsAPI.getProfile();

      expect(result).toEqual(profile);
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/users/me/profile",
        expect.objectContaining({ credentials: "include" })
      );
    });

    it("updates user profile", async () => {
      const updated = {
        user_id: "user-123",
        username: "testuser",
        display_name: "Updated Name",
        email: "test@example.com",
        avatar_url: null,
        bio: "New bio",
        location: "New York",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-15T11:00:00Z",
      };
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(updated), { status: 200 })
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await settingsAPI.updateProfile({
        display_name: "Updated Name",
        bio: "New bio",
        location: "New York",
      });

      expect(result).toEqual(updated);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe("PATCH");
    });
  });

  describe("SSH keys API", () => {
    it("fetches SSH keys list", async () => {
      const keys = [
        {
          key_id: "key-1",
          title: "Work Laptop",
          key_type: "Ed25519" as const,
          key_bits: 256,
          public_key: "ssh-ed25519 AAAA...",
          fingerprint: "SHA256:abc123",
          created_at: "2024-01-01T00:00:00Z",
          last_used_at: "2024-01-15T10:00:00Z",
        },
      ];
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(keys), { status: 200 })
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await settingsAPI.getSSHKeys();

      expect(result).toEqual(keys);
    });

    it("adds a new SSH key", async () => {
      const newKey = {
        key_id: "key-2",
        title: "Home Desktop",
        key_type: "RSA" as const,
        key_bits: 4096,
        public_key: "ssh-rsa AAAA...",
        fingerprint: "SHA256:def456",
        created_at: "2024-01-15T11:00:00Z",
        last_used_at: null,
      };
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(newKey), { status: 200 })
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await settingsAPI.addSSHKey({
        title: "Home Desktop",
        public_key: "ssh-rsa AAAA...",
      });

      expect(result).toEqual(newKey);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe("POST");
    });

    it("deletes an SSH key", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await settingsAPI.deleteSSHKey("key-1");

      expect(result).toEqual({ success: true });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/v1/users/me/ssh-keys/key-1");
      expect(init.method).toBe("DELETE");
    });
  });

  describe("sessions API", () => {
    it("fetches active sessions", async () => {
      const sessions = [
        {
          session_id: "sess-1",
          device_type: "desktop" as const,
          browser: "Chrome 120",
          os: "macOS 14",
          ip_address: "192.168.1.1",
          location: "San Francisco, US",
          created_at: "2024-01-10T00:00:00Z",
          last_active_at: "2024-01-15T10:00:00Z",
          is_current: true,
        },
      ];
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(sessions), { status: 200 })
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await settingsAPI.getSessions();

      expect(result).toEqual(sessions);
    });

    it("revokes a specific session", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await settingsAPI.revokeSession("sess-2");

      expect(result).toEqual({ success: true });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/v1/users/me/sessions/sess-2");
      expect(init.method).toBe("DELETE");
    });

    it("revokes all other sessions", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, revoked_count: 3 }), { status: 200 })
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await settingsAPI.revokeAllOtherSessions();

      expect(result).toEqual({ success: true, revoked_count: 3 });
    });
  });

  describe("agent preferences API", () => {
    it("fetches agent preferences", async () => {
      const agentPrefs = {
        output_verbosity: "standard" as const,
        confirmation_strategy: "batch" as const,
        automation_level: "balanced" as const,
        cross_session_memory_enabled: true,
        auto_evaluate_on_push: true,
        notify_evaluation_results: true,
        evaluation_strictness: "standard" as const,
        agent_review_enabled: true,
        agent_can_approve_low_risk: false,
        review_focus: {
          security: true,
          performance: true,
          code_style: false,
          test_coverage: true,
          documentation: false,
        },
      };
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(agentPrefs), { status: 200 })
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await settingsAPI.getAgentPreferences();

      expect(result).toEqual(agentPrefs);
    });

    it("updates agent preferences", async () => {
      const updated = {
        output_verbosity: "verbose" as const,
        confirmation_strategy: "auto" as const,
        automation_level: "aggressive" as const,
        cross_session_memory_enabled: false,
        auto_evaluate_on_push: false,
        notify_evaluation_results: false,
        evaluation_strictness: "lenient" as const,
        agent_review_enabled: false,
        agent_can_approve_low_risk: true,
        review_focus: {
          security: true,
          performance: false,
          code_style: true,
          test_coverage: false,
          documentation: true,
        },
      };
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(updated), { status: 200 })
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await settingsAPI.updateAgentPreferences({
        output_verbosity: "verbose",
      });

      expect(result).toEqual(updated);
    });

    it("clears agent memory", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await settingsAPI.clearAgentMemory();

      expect(result).toEqual({ success: true });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/v1/users/me/agent-memory/clear");
      expect(init.method).toBe("POST");
    });
  });

  describe("error handling", () => {
    it("throws error with message from API response", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "Invalid input" }), { status: 400 })
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(settingsAPI.getProfile()).rejects.toThrow("Invalid input");
    });

    it("throws generic error when response parsing fails", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(settingsAPI.getProfile()).rejects.toThrow("HTTP error 500");
    });
  });
});
