import { afterEach, describe, expect, it, vi } from "vitest";
import { APIError, accountAPI, authAPI, changesetAPI } from "./identity";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("identity API transport", () => {
  it("loads the current account with browser-managed session cookies", async () => {
    const account = { user_id: "user-1", display_name: "Ada", organizations: [{ id: "org-1", name: "Platform", role: "owner" }] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(account), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(accountAPI.current()).resolves.toEqual(account);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/me", expect.objectContaining({ credentials: "include" }));
  });

  it("sends the readable session-bound CSRF cookie only as a mutation header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", { cookie: "__Host-agentforge_csrf=csrf%2Bvalue" });

    await expect(authAPI.logout()).resolves.toBeUndefined();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe("include");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf+value");
  });

  it("preserves HTTP status and problem detail for authorization failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      title: "Forbidden", detail: "Only organization administrators can perform this action",
    }), { status: 403, headers: { "Content-Type": "application/problem+json" } })));

    await expect(accountAPI.current()).rejects.toMatchObject({
      name: "APIError", status: 403, message: "Only organization administrators can perform this action",
    } satisfies Partial<APIError>);
  });
});


describe("changeset API", () => {
  it("scopes list and create operations to the selected organization", async () => {
    const created = { changeset: { id: "cs-1", title: "Harden sessions", repository: "platform/api" }, version: 1 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], limit: 100, offset: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", { cookie: "__Host-agentforge_csrf=csrf-token" });

    await expect(changesetAPI.list("org / one")).resolves.toMatchObject({ items: [], limit: 100 });
    await expect(changesetAPI.create("org / one", "platform/api", "Harden sessions")).resolves.toMatchObject(created);

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/organizations/org%20%2F%20one/changesets?limit=100&offset=0");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/organizations/org%20%2F%20one/changesets");
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ repository: "platform/api", title: "Harden sessions" });
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf-token");
  });
});
