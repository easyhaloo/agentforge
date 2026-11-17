import { describe, expect, it, vi } from "vitest";
import worker from "./worker";

describe("Cloudflare Worker asset adapter", () => {
  it("delegates requests to the versioned static asset binding", async () => {
    const request = new Request("https://agentforge.gangshusheng.workers.dev/");
    const response = new Response("AgentForge", { status: 200 });
    const fetchAsset = vi.fn().mockResolvedValue(response);

    const result = await worker.fetch(request, { ASSETS: { fetch: fetchAsset } });

    expect(fetchAsset).toHaveBeenCalledWith(request);
    expect(result).toBe(response);
  });
});
