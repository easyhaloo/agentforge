export type RepositoryDiffLine = {
  kind: "add" | "remove" | "context" | "meta";
  text: string;
  oldLine?: number;
  newLine?: number;
};
export type RepositoryDiffHunk = { header: string; lines: RepositoryDiffLine[] };
export type RepositoryDiffFile = {
  header: string;
  hunks: RepositoryDiffHunk[];
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  renameTo?: string;
};

export function parseRepositoryDiff(patch: string): RepositoryDiffFile[] {
  if (!patch) return [];
  const files: RepositoryDiffFile[] = [];
  let file: RepositoryDiffFile | undefined;
  let hunk: RepositoryDiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;
  const normalized = patch.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) lines.pop();
  for (const line of lines) {
    const isFileHeader = line.startsWith("diff --git ");
    if (!file || isFileHeader) {
      file = { header: isFileHeader ? line : "Diff", hunks: [], status: "modified", additions: 0, deletions: 0 };
      files.push(file);
      hunk = undefined;
      if (isFileHeader) continue;
    }
    if (line.startsWith("@@")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (!match) { hunk = undefined; continue; }
      oldLine = Number(match[1]);
      newLine = Number(match[2]);
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    // Git file headers and extended metadata precede the first hunk; keep them out of line rows.
    if (!hunk) {
      if (line.startsWith("new file mode ") || line === "--- /dev/null") file.status = "added";
      else if (line.startsWith("deleted file mode ") || line === "+++ /dev/null") file.status = "deleted";
      else if (line.startsWith("rename from ")) file.status = "renamed";
      else if (line.startsWith("rename to ")) {
        file.status = "renamed";
        file.renameTo = line.slice("rename to ".length);
      }
      continue;
    }
    if (line === "\\ No newline at end of file") hunk.lines.push({ kind: "meta", text: line });
    else if (line.startsWith("+")) {
      file.additions++;
      hunk.lines.push({ kind: "add", text: line.slice(1), newLine: newLine++ });
    } else if (line.startsWith("-")) {
      file.deletions++;
      hunk.lines.push({ kind: "remove", text: line.slice(1), oldLine: oldLine++ });
    } else if (line.startsWith(" ") || line === "") hunk.lines.push({ kind: "context", text: line.startsWith(" ") ? line.slice(1) : "", oldLine: oldLine++, newLine: newLine++ });
    else hunk.lines.push({ kind: "meta", text: line });
  }
  return files;
}
