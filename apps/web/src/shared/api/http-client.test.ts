import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./problem-details";
import { createApiClient } from "./http-client";

describe("createApiClient", () => {
  it("sends JSON requests with credentials and parses JSON responses", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "PRJ-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createApiClient("https://api.example.test/", fetcher);

    const result = await client.request<{ id: string }>("/api/v1/projects", {
      method: "POST",
      body: { name: "Platform" },
    });

    expect(result).toEqual({ id: "PRJ-1" });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.example.test/api/v1/projects");
    expect(init?.credentials).toBe("include");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(init?.body).toBe(JSON.stringify({ name: "Platform" }));
  });

  it("preserves server problem details and request identifiers", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        type: "about:blank",
        title: "Conflict",
        status: 409,
        detail: "The changeset revision is no longer current.",
        code: "REVISION_STALE",
        requestId: "req-123",
      }), {
        status: 409,
        headers: { "Content-Type": "application/problem+json" },
      }),
    );
    const client = createApiClient("/api", fetcher);

    await expect(client.request("/v1/changesets/CS-1/merge")).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      code: "REVISION_STALE",
      requestId: "req-123",
      message: "The changeset revision is no longer current.",
    });
  });

  it("returns undefined for successful no-content responses", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createApiClient("", fetcher);

    await expect(client.request<void>("/api/v1/session", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("retains a useful error when the server does not return problem JSON", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("upstream unavailable", { status: 502 }),
    );
    const client = createApiClient("", fetcher);

    await expect(client.request("/api/v1/projects")).rejects.toBeInstanceOf(ApiError);
    await expect(client.request("/api/v1/projects")).rejects.toThrow("upstream unavailable");
  });
});
