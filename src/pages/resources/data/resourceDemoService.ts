import type { PageConfig, ResourceActionMode } from "./resourceConfigs";
import type { ResourceRecord } from "./resourceRecords";

export type ResourceAction =
  | { type: "review-queue"; query: ""; status: "Pending"; message: string }
  | { type: "demo"; message: string }
  | { type: "export"; filename: string; recordCount: number; message: string };

export function createResourceDraft(page: string, name: string, id: string): ResourceRecord {
  const common = { id, name: name.trim(), owner: "You" };
  switch (page) {
    case "Projects":
      return { kind: "project", ...common, description: "New local demo project", repositoryCount: 0, lifecycle: "Draft", updatedAt: "Just now" };
    case "Repositories":
      return { kind: "repository", ...common, projectName: "Unassigned", language: "Unknown", health: "Draft", updatedAt: "Just now" };
    case "Workspaces":
      return { kind: "workspace", ...common, changesetId: "Unlinked", runtime: "Not provisioned", state: "Draft", updatedAt: "Just now" };
    default:
      return { kind: "resource", ...common, detail: `Created in ${page} · local demo record`, status: "Draft", updated: "Just now" };
  }
}

export function resolveResourceAction(mode: ResourceActionMode, page: string, action: string, recordCount: number): ResourceAction | null {
  switch (mode) {
    case "review-queue":
      return { type: "review-queue", query: "", status: "Pending", message: "Showing pending review decisions from local demo data." };
    case "demo":
      return { type: "demo", message: `${action}: local demo simulation only; no remote operation was performed.` };
    case "export": {
      const filename = `agentforge-${page.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
      return { type: "export", filename, recordCount, message: `Exported ${recordCount} local demo records to ${filename}.` };
    }
    case "create":
    case "none":
      return null;
  }
}

export function resolvePageAction(config: PageConfig, page: string, recordCount: number) {
  return resolveResourceAction(config.actionMode, page, config.action, recordCount);
}
