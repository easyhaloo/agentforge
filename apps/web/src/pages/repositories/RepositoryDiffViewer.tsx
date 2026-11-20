import { useEffect, useState, type CSSProperties } from "react";
import { detectCodeLanguage } from "../../shared/code/languages";
import { highlightRepositorySource, type RepositorySyntaxResult } from "./repositorySyntax";
import { parseRepositoryDiff, type RepositoryDiffFile, type RepositoryDiffHunk } from "./repositoryDiff";

const MAX_DIFF_HIGHLIGHT_BYTES = 256 * 1024;
const MAX_DIFF_HIGHLIGHT_LINES = 10_000;

function getDiffFilePath(file: RepositoryDiffFile): string {
  const match = /^diff --git a\/.+ b\/(.+)$/.exec(file.header);
  return match?.[1] ?? file.header;
}

function tokenStyle(token: RepositorySyntaxResult["tokens"][number][number]): CSSProperties {
  const style: CSSProperties = {};
  if (token.color) style.color = token.color;
  if (token.fontStyle !== undefined) {
    if (token.fontStyle & 1) style.fontStyle = "italic";
    if (token.fontStyle & 2) style.fontWeight = 700;
  }
  return style;
}

function renderTokens(tokens: RepositorySyntaxResult["tokens"][number] | undefined, fallback: string) {
  if (!tokens?.length) return fallback;
  return tokens.map((token, index) => token.color || token.fontStyle
    ? <span key={index} className="repository-code__shiki-token" style={tokenStyle(token)}>{token.content}</span>
    : <span key={index}>{token.content}</span>);
}

function RepositoryDiffFileView({ file }: { file: RepositoryDiffFile }) {
  const [tokensByHunk, setTokensByHunk] = useState<Record<number, RepositorySyntaxResult["tokens"]>>({});
  const path = getDiffFilePath(file);
  const language = detectCodeLanguage(path);

  useEffect(() => {
    let current = true;
    setTokensByHunk({});
    if (!language) return () => { current = false; };

    const hunkSources = file.hunks.map(hunk => hunk.lines.filter(line => line.kind !== "meta").map(line => line.text));
    const totalLines = hunkSources.reduce((count, lines) => count + lines.length, 0);
    const totalBytes = hunkSources.reduce((count, lines) => count + new TextEncoder().encode(lines.join("\n")).byteLength, 0);
    if (totalLines > MAX_DIFF_HIGHLIGHT_LINES || totalBytes > MAX_DIFF_HIGHLIGHT_BYTES) {
      return () => { current = false; };
    }

    void Promise.all(hunkSources.map(lines => lines.length
      ? highlightRepositorySource(lines.join("\n"), language.shiki)
      : Promise.resolve(null)))
      .then(results => {
        if (!current) return;
        const next: Record<number, RepositorySyntaxResult["tokens"]> = {};
        results.forEach((result, index) => { if (result) next[index] = result.tokens; });
        setTokensByHunk(next);
      })
      .catch(() => { if (current) setTokensByHunk({}); });

    return () => { current = false; };
  }, [file, language]);

  return <section className="repository-diff__file" data-highlight-engine={language ? (Object.keys(tokensByHunk).length ? "shiki" : "pending") : "plain-text"}>
    <h4>{file.header.replace(/^diff --git a\//, "").replace(/ b\//, " → ")}</h4>
    {file.hunks.map((hunk, hunkIndex) => <RepositoryDiffHunkView key={hunkIndex} hunk={hunk} tokens={tokensByHunk[hunkIndex]} />)}
  </section>;
}

function RepositoryDiffHunkView({ hunk, tokens }: { hunk: RepositoryDiffHunk; tokens?: RepositorySyntaxResult["tokens"] }) {
  let tokenLine = 0;
  return <div>
    <div className="repository-diff__hunk">{hunk.header}</div>
    {hunk.lines.map((line, lineIndex) => {
      const lineTokens = line.kind === "meta" ? undefined : tokens?.[tokenLine++];
      return <div className={"repository-diff__line repository-diff__line--" + line.kind} key={lineIndex}>
        <span>{line.oldLine ?? ""}</span><span>{line.newLine ?? ""}</span>
        <code>{line.kind === "add" ? "+" : line.kind === "remove" ? "-" : line.kind === "context" ? " " : ""}{renderTokens(lineTokens, line.text)}</code>
      </div>;
    })}
  </div>;
}

export function RepositoryDiffViewer({ patch }: { patch: string }) {
  const files = parseRepositoryDiff(patch);
  if (!files.length) return <p className="changeset-hint">No textual changes in this comparison.</p>;
  return <div className="repository-diff">
    {files.map((file, fileIndex) => <RepositoryDiffFileView file={file} key={fileIndex} />)}
  </div>;
}
