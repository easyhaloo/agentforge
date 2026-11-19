import { Fragment, type ReactNode } from "react";

function safeLink(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** Minimal Markdown renderer: raw HTML is always text; images and unsafe URL schemes are inert. */
function inline(text: string): ReactNode[] {
  const token = /(`[^`]*`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  const output: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(text))) {
    if (match.index > cursor) output.push(text.slice(cursor, match.index));
    const value = match[0];
    if (value.startsWith("`")) output.push(<code key={match.index}>{value.slice(1, -1)}</code>);
    else if (value.startsWith("**")) output.push(<strong key={match.index}>{value.slice(2, -2)}</strong>);
    else if (value.startsWith("*")) output.push(<em key={match.index}>{value.slice(1, -1)}</em>);
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(value);
      const href = link ? safeLink(link[2].trim()) : null;
      if (link && href) output.push(<a key={match.index} href={href} target="_blank" rel="noopener noreferrer">{link[1]}</a>);
      else output.push(value);
    }
    cursor = match.index + value.length;
  }
  if (cursor < text.length) output.push(text.slice(cursor));
  return output;
}

export function RepositoryReadme({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    if (line.startsWith("```")) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index].startsWith("```")) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(<pre key={index}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const children = inline(heading[2]);
      blocks.push(<Fragment key={index}>{level === 1 ? <h1>{children}</h1> : level === 2 ? <h2>{children}</h2> : level === 3 ? <h3>{children}</h3> : level === 4 ? <h4>{children}</h4> : level === 5 ? <h5>{children}</h5> : <h6>{children}</h6>}</Fragment>);
      index++;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(<li key={index}>{inline(lines[index].replace(/^\s*[-*+]\s+/, ""))}</li>);
        index++;
      }
      blocks.push(<ul key={index}>{items}</ul>);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(<li key={index}>{inline(lines[index].replace(/^\s*\d+\.\s+/, ""))}</li>);
        index++;
      }
      blocks.push(<ol key={index}>{items}</ol>);
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].startsWith(">")) quote.push(lines[index++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={index}>{quote.map((part, i) => <p key={i}>{inline(part)}</p>)}</blockquote>);
      continue;
    }
    const paragraph = [line];
    index++;
    while (index < lines.length && lines[index].trim() && !/^(#{1,6})\s|^```|^\s*[-*+]\s+|^\s*\d+\.\s+|^>/.test(lines[index])) paragraph.push(lines[index++]);
    blocks.push(<p key={index}>{inline(paragraph.join(" "))}</p>);
  }
  return <article className="repository-readme">{blocks}</article>;
}
