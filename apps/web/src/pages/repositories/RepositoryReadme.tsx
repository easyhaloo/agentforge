import { Fragment, type ReactNode } from "react";
import { resolveRepositoryMarkdownTarget } from "./repositoryMarkdown";

function inline(text: string, sourcePath: string, onOpenPath?: (path: string) => void): ReactNode[] {
  const token = /(!?\[[^\]]*\]\([^)]+\)|\x60[^\x60]*\x60|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const output: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(text))) {
    if (match.index > cursor) output.push(text.slice(cursor, match.index));
    const value = match[0];
    if (value.startsWith(String.fromCharCode(96))) output.push(<code key={match.index}>{value.slice(1, -1)}</code>);
    else if (value.startsWith("**")) output.push(<strong key={match.index}>{value.slice(2, -2)}</strong>);
    else if (value.startsWith("*")) output.push(<em key={match.index}>{value.slice(1, -1)}</em>);
    else {
      const image = value.startsWith("!");
      const link = /^!?\[([^\]]*)\]\(([^)]+)\)$/.exec(value);
      const destination = link?.[2].trim();
      const resolved = destination ? resolveRepositoryMarkdownTarget(destination, sourcePath) : { kind: "unsafe" as const };
      const label = image ? "Image: " + (link?.[1] || "untitled") : (link?.[1] || value);
      if (resolved.kind === "external") output.push(<a key={match.index} href={resolved.href} target="_blank" rel="noopener noreferrer">{label}</a>);
      else if (resolved.kind === "anchor") output.push(<a key={match.index} href={resolved.href}>{label}</a>);
      else if (resolved.kind === "internal" && onOpenPath) output.push(<a key={match.index} href={"#repository-file-" + encodeURIComponent(resolved.path)} onClick={event => { event.preventDefault(); onOpenPath(resolved.path); }}>{label}</a>);
      else output.push(value);
    }
    cursor = match.index + value.length;
  }
  if (cursor < text.length) output.push(text.slice(cursor));
  return output;
}

export function RepositoryReadme({ content, sourcePath = "README.md", onOpenPath }: { content: string; sourcePath?: string; onOpenPath?: (path: string) => void }) {
  const renderInline = (value: string) => inline(value, sourcePath, onOpenPath);
  const fence = String.fromCharCode(96).repeat(3);
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    if (line.startsWith(fence)) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index].startsWith(fence)) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(<pre key={index}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const children = renderInline(heading[2]);
      blocks.push(<Fragment key={index}>{level === 1 ? <h1>{children}</h1> : level === 2 ? <h2>{children}</h2> : level === 3 ? <h3>{children}</h3> : level === 4 ? <h4>{children}</h4> : level === 5 ? <h5>{children}</h5> : <h6>{children}</h6>}</Fragment>);
      index++;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) { items.push(<li key={index}>{renderInline(lines[index].replace(/^\s*[-*+]\s+/, ""))}</li>); index++; }
      blocks.push(<ul key={index}>{items}</ul>);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) { items.push(<li key={index}>{renderInline(lines[index].replace(/^\s*\d+\.\s+/, ""))}</li>); index++; }
      blocks.push(<ol key={index}>{items}</ol>);
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].startsWith(">")) quote.push(lines[index++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={index}>{quote.map((part, i) => <p key={i}>{renderInline(part)}</p>)}</blockquote>);
      continue;
    }
    const paragraph = [line];
    index++;
    while (index < lines.length && lines[index].trim() && !/^(#{1,6})\s|^\x60{3}|^\s*[-*+]\s+|^\s*\d+\.\s+|^>/.test(lines[index])) paragraph.push(lines[index++]);
    blocks.push(<p key={index}>{renderInline(paragraph.join(" "))}</p>);
  }
  return <article className="repository-readme">{blocks}</article>;
}
