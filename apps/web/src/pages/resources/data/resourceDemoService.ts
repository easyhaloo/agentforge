import type { PageConfig, ResourceActionMode } from "./resourceConfigs";
import type { ResourceRecord } from "../../../entities/resource-records";

export type ResourceAction =
  | { type: "review-queue"; query: ""; status: "Pending"; message: string }
  | { type: "demo"; message: string }
  | { type: "export"; filename: string; recordCount: number; message: string };

export function createResourceDraft(page: string, name: string, id: string): ResourceRecord {
  const common = { id, name: name.trim(), owner: "You", updatedAt: "Just now" };
  switch (page) {
    case "Projects":
      return { kind: "project", ...common, description: "New local demo project", repositoryCount: 0, lifecycle: "Draft" };
    case "Workspaces":
      return { kind: "workspace", ...common, changesetId: "Unlinked", runtime: "Not provisioned", state: "Draft" };
    case "Changesets":
      return { kind: "changeset", ...common, revisionNumber: 1, repositoryName: "Unassigned", status: "Draft" };
    case "Trails":
      return { kind: "trail", ...common, completedChangesets: 0, totalChangesets: 0, repositoryCount: 0, health: "Draft" };
    case "Stacks":
      return { kind: "stack", ...common, changesetCount: 0, baseBranch: "main", state: "Draft" };
    case "Memory":
      return { kind: "memory-entry", ...common, category: "Unclassified", source: "Local draft", confidence: "Review needed" };
    case "Security":
      return { kind: "security-finding", ...common, resource: "Unassigned", scan: "Manual", severity: "Untriaged" };
    case "Governance":
      return { kind: "governance-policy", ...common, scope: "Workspace", enforcement: "Advisory", policyState: "Draft" };
    default:
      return { kind: "unclassified", id, name: name.trim(), owner: "You", detail: `Created in ${page} · local demo record`, status: "Draft", updated: "Just now" };
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
