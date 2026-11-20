/**
 * Build stable, URI-safe identities for editor models.
 *
 * Monaco parses model keys as URIs; raw file names containing spaces, #, ?, or
 * percent signs must be encoded so they cannot change the URI path/query/fragment.
 * Encode each path segment independently to preserve directory separators.
 */
function encodePath(path: string): string {
  return path.split("/").map(segment => encodeURIComponent(segment)).join("/");
}

export function changesetEditorModelKey(
  organizationId: string,
  repository: string,
  changesetId: string,
  path: string,
): string {
  const repositoryPath = repository.split("/").map(segment => encodeURIComponent(segment)).join("/");
  return `changeset://${encodeURIComponent(organizationId)}/${repositoryPath}/${encodeURIComponent(changesetId)}/${encodePath(path)}`;
}

export function workspaceEditorModelKey(workspaceId: string, path: string): string {
  return `workspace://${encodeURIComponent(workspaceId)}/${encodePath(path)}`;
}
