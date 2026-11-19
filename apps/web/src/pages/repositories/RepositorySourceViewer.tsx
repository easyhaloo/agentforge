import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "../../shared/ui";

type TokenKind = "keyword" | "string" | "number" | "comment";
const KEYWORDS = new Set(["as","async","await","break","case","catch","class","const","continue","def","else","export","extends","false","for","from","func","function","if","import","in","interface","let","match","new","nil","null","package","pass","private","public","return","self","static","struct","switch","this","throw","true","try","type","var","while","yield"]);

export function repositoryLanguage(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  const languages: Record<string, string> = { c:"C",cc:"C++",cpp:"C++",cs:"C#",css:"CSS",go:"Go",h:"C",hpp:"C++",html:"HTML",java:"Java",js:"JavaScript",json:"JSON",jsx:"JSX",md:"Markdown",mdx:"MDX",py:"Python",rs:"Rust",sh:"Shell",sql:"SQL",toml:"TOML",ts:"TypeScript",tsx:"TSX",xml:"XML",yaml:"YAML",yml:"YAML" };
  return languages[extension] ?? (path.split("/").at(-1) ?? "Text");
}

function tokenKind(value: string): TokenKind | null {
  if (/^(?:\/\/|#|\/\*|\*)/.test(value)) return "comment";
  if (/^(?:"|'|`)/.test(value)) return "string";
  if (/^\d/.test(value)) return "number";
  if (KEYWORDS.has(value)) return "keyword";
  return null;
}

function highlightLine(line: string) {
  const pattern = /(\/\/.*|#.*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g;
  const nodes = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) {
    if (match.index > cursor) nodes.push(line.slice(cursor, match.index));
    const value = match[0];
    const kind = tokenKind(value);
    nodes.push(kind ? <span key={match.index} className={`repository-code__token repository-code__token--${kind}`}>{value}</span> : value);
    cursor = match.index + value.length;
  }
  if (cursor < line.length) nodes.push(line.slice(cursor));
  return nodes;
}

export function RepositorySourceViewer({ path, content, activeLine = 0 }: { path: string; content: string; activeLine?: number }) {
  const [copied, setCopied] = useState(false);
  const language = repositoryLanguage(path);
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const copy = async () => {
    try { await navigator.clipboard.writeText(content); setCopied(true); }
    catch { setCopied(false); }
  };
  return <section className="repository-source" aria-label="Source code">
    <header className="repository-source__toolbar">
      <div><strong>{path.split("/").at(-1)}</strong><span>{language} · {lines.length} lines</span></div>
      <Button className="button secondary" onClick={() => void copy()} aria-label="Copy source code">{copied ? <Check size={13}/> : <Copy size={13}/>} {copied ? "Copied" : "Copy"}</Button>
    </header>
    <pre className="repository-source__code"><code>{lines.map((line,index) => <span className={"repository-source__line" + (activeLine === index + 1 ? " repository-source__line--active" : "")} id={"line-" + (index + 1)} key={index}><span className="repository-source__number" aria-hidden="true">{index+1}</span><span className="repository-source__text">{highlightLine(line)}</span></span>)}</code></pre>
  </section>;
}
