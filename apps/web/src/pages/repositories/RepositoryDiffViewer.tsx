import { parseRepositoryDiff } from "./repositoryDiff";

export function RepositoryDiffViewer({ patch }: { patch: string }) {
  const files = parseRepositoryDiff(patch);
  if (!files.length) return <p className="changeset-hint">No textual changes in this comparison.</p>;
  return <div className="repository-diff">
    {files.map((file, fileIndex) => <section className="repository-diff__file" key={fileIndex}>
      <h4>{file.header.replace(/^diff --git a\\//, "").replace(/ b\\//, " → ")}</h4>
      {file.hunks.map((hunk, hunkIndex) => <div key={hunkIndex}>
        <div className="repository-diff__hunk">{hunk.header}</div>
        {hunk.lines.map((line, lineIndex) => <div className={`repository-diff__line repository-diff__line--${line.kind}`} key={lineIndex}>
          <span>{line.oldLine ?? ""}</span><span>{line.newLine ?? ""}</span><code>{line.kind === "add" ? "+" : line.kind === "remove" ? "-" : line.kind === "context" ? " " : ""}{line.text}</code>
        </div>)}
      </div>)}
    </section>)}
  </div>;
}
