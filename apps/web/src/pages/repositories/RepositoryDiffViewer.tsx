import { useEffect, useMemo, useState, type CSSProperties, Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { detectCodeLanguage } from "../../shared/code/languages";
import { highlightRepositorySource, type RepositorySyntaxResult } from "./repositorySyntax";
import { parseRepositoryDiff, type RepositoryDiffFile, type RepositoryDiffHunk, type RepositoryDiffLine } from "./repositoryDiff";

const MAX_DIFF_HIGHLIGHT_BYTES = 256 * 1024;
const MAX_DIFF_HIGHLIGHT_LINES = 10_000;

function decodeQuotedPath(path: string): string {
  const escapes: Record<string, string> = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", '"': '"', "\\": "\\" };
  return path.replace(/(?:\\[0-7]{3})+|\\[abfnrtv"\\]/g, escaped => {
    if (escaped.length === 2) return escapes[escaped[1]];
    return new TextDecoder().decode(Uint8Array.from(escaped.slice(1).split("\\"), octal => parseInt(octal, 8)));
  });
}

export function getDiffFilePath(file: RepositoryDiffFile): string {
  if (file.renameTo) {
    return file.renameTo.startsWith('"') ? decodeQuotedPath(file.renameTo.slice(1, -1)) : file.renameTo;
  }
  const header = file.header;
  const match = /^diff --git "(?:[^"\\]|\\.)*" "b\/((?:[^"\\]|\\.)*)"$/.exec(header);
  if (match) return decodeQuotedPath(match[1]);
  const repeated = header.slice("diff --git a/".length).slice(0, (header.length - "diff --git a/ b/".length) / 2);
  if (header === `diff --git a/${repeated} b/${repeated}`) return repeated;
  return /^diff --git a\/.+ b\/(.+)$/.exec(header)?.[1] ?? header;
}

export const getDiffFileId = (path: string) => `pull-file-${encodeURIComponent(path)}`;

function tokenStyle(token: RepositorySyntaxResult["tokens"][number][number]): CSSProperties {
  const style: CSSProperties = {};
  style.color = token.htmlStyle?.color
    ? `color-mix(in srgb, ${token.htmlStyle.color} 65%, var(--af-color-text))`
    : token.color;
  if (token.fontStyle !== undefined) {
    if (token.fontStyle & 1) style.fontStyle = "italic";
    if (token.fontStyle & 2) style.fontWeight = 700;
  }
  return style;
}

function renderTokens(tokens: RepositorySyntaxResult["tokens"][number] | undefined, fallback: string) {
  if (!tokens?.length) return fallback;
  return tokens.map((token, index) => token.htmlStyle?.color || token.color || token.fontStyle
    ? <span key={index} className="repository-code__shiki-token" style={tokenStyle(token)}>{token.content}</span>
    : <span key={index}>{token.content}</span>);
}

type DiffLineControl = (path: string, side: "left" | "right", line: number) => ReactNode;
type DiffInteractions = { lineControl?: DiffLineControl; lineDiscussion?: DiffLineControl };
type DiffViewMode = "unified" | "split";
type DiffCell = { line: RepositoryDiffLine; tokens?: RepositorySyntaxResult["tokens"][number]; note?: string };
type SplitRow = { left?: DiffCell; right?: DiffCell; meta?: DiffCell };

function splitRows(cells: DiffCell[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let left: DiffCell[] = [];
  let right: DiffCell[] = [];
  let lastChange: DiffCell | undefined;
  function flush() {
    for (let i = 0; i < Math.max(left.length, right.length); i++) rows.push({ left: left[i], right: right[i] });
    left = [];
    right = [];
    lastChange = undefined;
  }
  for (const cell of cells) {
    if (cell.line.kind === "remove" || cell.line.kind === "add") {
      lastChange = { ...cell };
      (cell.line.kind === "remove" ? left : right).push(lastChange);
    } else if (lastChange && cell.line.text === "\\ No newline at end of file" && cell.line.kind === "meta") {
      lastChange.note = cell.line.text;
    } else {
      flush();
      rows.push(cell.line.kind === "context" ? { left: cell, right: cell } : { meta: cell });
    }
  }
  flush();
  return rows;
}

function RepositoryDiffFileView({ file, id, collapsed, locked, onToggleFile, viewMode, ...interactions }: DiffInteractions & {
  file: RepositoryDiffFile; id?: string; collapsed: boolean; locked: boolean; onToggleFile?: (path: string) => void; viewMode: DiffViewMode;
}) {
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
      ? highlightRepositorySource(lines.join("\n"), language.shiki, true)
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

  const hunks = file.hunks.map((hunk, hunkIndex) => <RepositoryDiffHunkView key={hunkIndex} hunk={hunk} tokens={tokensByHunk[hunkIndex]} path={path} viewMode={viewMode} {...interactions} />);
  return <section id={id} className="repository-diff__file" data-highlight-engine={highlightStatus}>
    {id ? <details open={!collapsed}><summary aria-disabled={locked || undefined} onClick={onToggleFile && (event => {
      event.preventDefault();
      if (!locked) onToggleFile(path);
    })}>{path}</summary>{hunks}</details> : <>
      <h4>{file.header.replace(/^diff --git a\//, "").replace(/ b\//, " → ")}</h4>{hunks}
    </>}
  </section>;
}

function RepositoryDiffHunkView({ hunk, tokens, path, viewMode, lineControl, lineDiscussion }: DiffInteractions & {
  hunk: RepositoryDiffHunk; tokens?: RepositorySyntaxResult["tokens"]; path: string; viewMode: DiffViewMode;
}) {
  let tokenLine = 0;
  const cells = hunk.lines.map(line => ({ line, tokens: line.kind === "meta" ? undefined : tokens?.[tokenLine++] }));
  const lineNumber = (side: "left" | "right", number?: number) =>
    number === undefined ? "" : lineControl?.(path, side, number) ?? number;
  const discussion = (side: "left" | "right", number?: number) =>
    number === undefined ? null : lineDiscussion?.(path, side, number);
  const code = ({ line, tokens, note }: DiffCell) => <code>
    {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : line.kind === "context" ? " " : ""}
    {renderTokens(tokens, line.text)}
    {note && <span className="repository-diff__note">{note}</span>}
  </code>;
  const splitCell = (side: "left" | "right", cell?: DiffCell) => cell
    ? <div className={`repository-diff__line repository-diff__line--${cell.line.kind}`} data-side={side}>
      <span>{lineNumber(side, side === "left" ? cell.line.oldLine : cell.line.newLine)}</span>{code(cell)}
    </div>
    : <div className="repository-diff__split-empty" data-side={side} aria-hidden="true"/>;
  return <div>
    <div className="repository-diff__hunk">{hunk.header}</div>
    {viewMode === "split" ? splitRows(cells).map(({ left, right, meta }, index) => meta
      ? <div key={index} className="repository-diff__split-meta">{code(meta)}</div>
      : <Fragment key={index}>
        <div className="repository-diff__split-row">{splitCell("left", left)}{splitCell("right", right)}</div>
        {discussion("left", left?.line.oldLine)}
        {discussion("right", right?.line.newLine)}
      </Fragment>)
      : cells.map((cell, index) => <Fragment key={index}>
        <div className={`repository-diff__line repository-diff__line--${cell.line.kind}`}>
          <span>{lineNumber("left", cell.line.oldLine)}</span><span>{lineNumber("right", cell.line.newLine)}</span>{code(cell)}
        </div>
        {discussion("left", cell.line.oldLine)}
        {discussion("right", cell.line.newLine)}
      </Fragment>)}
  </div>;
}

export function RepositoryDiffViewer({ patch, files: suppliedFiles, viewMode = "unified", collapsedFiles, lockedFile, onToggleFile, ...interactions }: DiffInteractions & {
  patch?: string; files?: RepositoryDiffFile[]; viewMode?: DiffViewMode;
  collapsedFiles?: ReadonlySet<string>; lockedFile?: string; onToggleFile?: (path: string) => void;
}) {
  const { t } = useTranslation("repositories");
  const files = useMemo(() => suppliedFiles ?? parseRepositoryDiff(patch ?? ""), [suppliedFiles, patch]);
  if (!files.length) return <p className="changeset-hint">{t("compare.noChanges")}</p>;
  return <div className={`repository-diff repository-diff--${viewMode}`}>
    {files.map(file => {
      const path = getDiffFilePath(file);
      return <RepositoryDiffFileView file={file} key={file.header}
        id={suppliedFiles ? getDiffFileId(path) : undefined} viewMode={viewMode}
        collapsed={collapsedFiles?.has(path) ?? false} locked={lockedFile === path} onToggleFile={onToggleFile} {...interactions}/>;
    })}
  </div>;
}
