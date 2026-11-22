import { useEffect, useMemo, useState, type CSSProperties, Fragment, type ReactNode } from "react";
import { detectCodeLanguage } from "../../shared/code/languages";
import { highlightRepositorySource, type RepositorySyntaxResult } from "./repositorySyntax";
import { parseRepositoryDiff, type RepositoryDiffFile, type RepositoryDiffHunk } from "./repositoryDiff";

const MAX_DIFF_HIGHLIGHT_BYTES = 256 * 1024;
const MAX_DIFF_HIGHLIGHT_LINES = 10_000;

export function getDiffFilePath(file: RepositoryDiffFile): string {
  const header = file.header;
  const match = /^diff --git "(?:[^"\\]|\\.)*" "b\/((?:[^"\\]|\\.)*)"$/.exec(header);
  if (match) {
    const escapes: Record<string, string> = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", '"': '"', "\\": "\\" };
    return match[1].replace(/(?:\\[0-7]{3})+|\\[abfnrtv"\\]/g, escaped => {
      if (escaped.length === 2) return escapes[escaped[1]];
      return new TextDecoder().decode(Uint8Array.from(escaped.slice(1).split("\\"), octal => parseInt(octal, 8)));
    });
  }
  const repeated = header.slice("diff --git a/".length).slice(0, (header.length - "diff --git a/ b/".length) / 2);
  if (header === `diff --git a/${repeated} b/${repeated}`) return repeated;
  return /^diff --git a\/.+ b\/(.+)$/.exec(header)?.[1] ?? header;
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

type DiffLineControl = (path: string, side: "left" | "right", line: number) => ReactNode;

function RepositoryDiffFileView({ file, lineControl, lineDiscussion, id, collapsible }: { file: RepositoryDiffFile; lineControl?: DiffLineControl; lineDiscussion?: DiffLineControl; id?: string; collapsible?: boolean }) {
  const path = getDiffFilePath(file);
  const language = detectCodeLanguage(path);
  const [tokensByHunk, setTokensByHunk] = useState<Record<number, RepositorySyntaxResult["tokens"]>>({});
  const [highlightStatus, setHighlightStatus] = useState<"pending" | "shiki" | "plain-text">(language ? "pending" : "plain-text");

  useEffect(() => {
    let current = true;
    setTokensByHunk({});
    if (!language) { setHighlightStatus("plain-text"); return () => { current = false; }; }

    const hunkSources = file.hunks.map(hunk => hunk.lines.filter(line => line.kind !== "meta").map(line => line.text));
    const totalLines = hunkSources.reduce((count, lines) => count + lines.length, 0);
    const totalBytes = hunkSources.reduce((count, lines) => count + new TextEncoder().encode(lines.join("\n")).byteLength, 0);
    if (totalLines > MAX_DIFF_HIGHLIGHT_LINES || totalBytes > MAX_DIFF_HIGHLIGHT_BYTES) {
      setHighlightStatus("plain-text");
      return () => { current = false; };
    }
    setHighlightStatus("pending");

    void Promise.all(hunkSources.map(lines => lines.length
      ? highlightRepositorySource(lines.join("\n"), language.shiki)
      : Promise.resolve(null)))
      .then(results => {
        if (!current) return;
        const next: Record<number, RepositorySyntaxResult["tokens"]> = {};
        results.forEach((result, index) => { if (result) next[index] = result.tokens; });
        setTokensByHunk(next);
        setHighlightStatus("shiki");
      })
      .catch(() => { if (current) { setTokensByHunk({}); setHighlightStatus("plain-text"); } });

    return () => { current = false; };
  }, [file, language]);

  const hunks = file.hunks.map((hunk, hunkIndex) => <RepositoryDiffHunkView key={hunkIndex} hunk={hunk} tokens={tokensByHunk[hunkIndex]} path={path} lineControl={lineControl} lineDiscussion={lineDiscussion} />);
  return <section id={id} className="repository-diff__file" data-highlight-engine={highlightStatus}>
    {collapsible ? <details open><summary>{path}</summary>{hunks}</details> : <>
      <h4>{file.header.replace(/^diff --git a\//, "").replace(/ b\//, " → ")}</h4>{hunks}
    </>}
  </section>;
}

function RepositoryDiffHunkView({ hunk, tokens, path, lineControl, lineDiscussion }: { hunk: RepositoryDiffHunk; tokens?: RepositorySyntaxResult["tokens"]; path: string; lineControl?: DiffLineControl; lineDiscussion?: DiffLineControl }) {
  let tokenLine = 0;
  return <div>
    <div className="repository-diff__hunk">{hunk.header}</div>
    {hunk.lines.map((line, lineIndex) => {
      const lineTokens = line.kind === "meta" ? undefined : tokens?.[tokenLine++];
      return <Fragment key={lineIndex}><div className={"repository-diff__line repository-diff__line--" + line.kind}>
        <span>{line.oldLine === undefined ? "" : lineControl?.(path, "left", line.oldLine) ?? line.oldLine}</span><span>{line.newLine === undefined ? "" : lineControl?.(path, "right", line.newLine) ?? line.newLine}</span>
        <code>{line.kind === "add" ? "+" : line.kind === "remove" ? "-" : line.kind === "context" ? " " : ""}{renderTokens(lineTokens, line.text)}</code>
      </div>
        {line.oldLine !== undefined && lineDiscussion?.(path, "left", line.oldLine)}
        {line.newLine !== undefined && lineDiscussion?.(path, "right", line.newLine)}
      </Fragment>;
    })}
  </div>;
}

export function RepositoryDiffViewer({ patch, files: suppliedFiles, lineControl, lineDiscussion }: { patch?: string; files?: RepositoryDiffFile[]; lineControl?: DiffLineControl; lineDiscussion?: DiffLineControl }) {
  const files = useMemo(() => suppliedFiles ?? parseRepositoryDiff(patch ?? ""), [suppliedFiles, patch]);
  if (!files.length) return <p className="changeset-hint">No textual changes in this comparison.</p>;
  return <div className="repository-diff">
    {files.map((file, fileIndex) => <RepositoryDiffFileView file={file} key={file.header + fileIndex} id={suppliedFiles ? `pull-file-${fileIndex}` : undefined} lineControl={lineControl} lineDiscussion={lineDiscussion} collapsible={!!suppliedFiles} />)}
  </div>;
}
