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
  it("sends the list filters and reads the total and the server status of the filtered set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{ changeset: { id: "cs-1", title: "Harden sessions", repository: "platform/api" }, status: "in_review", version: 3 }],
      total: 42, limit: 20, offset: 40,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const page = await changesetAPI.list("org / one", {
      q: "harden", repository: "platform/api", status: "in_review", reviewer: "me", limit: 20, offset: 40,
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/organizations/org%20%2F%20one/changesets?q=harden&repository=platform%2Fapi&status=in_review&reviewer=me&limit=20&offset=40",
    );
    expect(page.total).toBe(42);
    expect(page.items[0].status).toBe("in_review");
  });

  it("omits empty filters and always pages the list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0, limit: 20, offset: 0 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(changesetAPI.list("org-1")).resolves.toMatchObject({ items: [], total: 0 });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/organizations/org-1/changesets?limit=20&offset=0");
  });

  it("scopes list and create operations to the selected organization", async () => {
    const created = { changeset: { id: "cs-1", title: "Harden sessions", repository: "platform/api" }, status: "draft", version: 1 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], total: 0, limit: 20, offset: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", { cookie: "__Host-agentforge_csrf=csrf-token" });

    await expect(changesetAPI.list("org / one")).resolves.toMatchObject({ items: [], limit: 20 });
    await expect(changesetAPI.create("org / one", "platform/api", "Harden sessions")).resolves.toMatchObject(created);

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/organizations/org%20%2F%20one/changesets?limit=20&offset=0");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/organizations/org%20%2F%20one/changesets");
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ repository: "platform/api", title: "Harden sessions" });
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf-token");
  });
});
