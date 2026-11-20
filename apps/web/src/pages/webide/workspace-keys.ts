import type { WorkspaceDiffEntry, WorkspaceFile, WorkspaceStatus } from "../../shared/api/identity";

/**
 * The translation keys of the machine states the workspace API returns.
 *
 * The page builds these keys at runtime, so the translation test cannot see them in the `t()`
 * calls; `workspaceTranslationKeys` lists every key they can produce so the test can resolve
 * all of them in every shipped language.
 */

/** The translation key of a workspace lifecycle state. */
export function workspaceStatusKey(status: WorkspaceStatus): string {
  return `workspace.status.${status}`;
}

/** The translation key of the source a workspace file comes from. */
export function workspaceSourceKey(source: WorkspaceFile["source"]): string {
  return `workspace.source.${source}`;
}

/** The translation key of how a workspace diff classifies a file. */
export function workspaceDiffStatusKey(status: WorkspaceDiffEntry["status"]): string {
  return `workspace.diffStatus.${status}`;
}

/** Every workspace key the page can ask for at runtime. */
export const workspaceTranslationKeys: string[] = [
  ...(["active", "expired", "closed"] as WorkspaceStatus[]).map(workspaceStatusKey),
  ...(["base", "workspace"] as WorkspaceFile["source"][]).map(workspaceSourceKey),
  ...(["added", "modified"] as WorkspaceDiffEntry["status"][]).map(workspaceDiffStatusKey),
];
