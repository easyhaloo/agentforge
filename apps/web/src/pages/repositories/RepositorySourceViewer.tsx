import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../shared/ui";
import { codeLanguageLabel, detectCodeLanguage } from "../../shared/code/languages";

type TokenKind = "keyword" | "string" | "number" | "comment";
const KEYWORDS = new Set(["as","async","await","break","case","catch","class","const","continue","def","else","export","extends","false","for","from","func","function","if","import","in","interface","let","match","new","nil","null","package","pass","private","public","return","self","static","struct","switch","this","throw","true","try","type","var","while","yield"]);
const MAX_HIGHLIGHT_BYTES = 256 * 1024;
const MAX_HIGHLIGHT_LINES = 10_000;

export function repositoryLanguage(path: string, firstLine = ""): string {
  return codeLanguageLabel(path, firstLine);
}

export function shouldHighlightRepositorySource(path: string, content: string): boolean {
  if (!detectCodeLanguage(path, content.split("\n", 1)[0] ?? "")) return false;
  if (content.length > MAX_HIGHLIGHT_BYTES) return false;
  if (new TextEncoder().encode(content).byteLength > MAX_HIGHLIGHT_BYTES) return false;
  return content.split("\n").length <= MAX_HIGHLIGHT_LINES;
}

function tokenKind(value: string): TokenKind | null {
  if (/^(?:\/\/|#|\/\*|\*)/.test(value)) return "comment";
  if (/^(?:"|'|\x60)/.test(value)) return "string";
  if (/^\d/.test(value)) return "number";
  if (KEYWORDS.has(value)) return "keyword";
  return null;
}

function highlightLine(line: string) {
  const pattern = /(\/\/.*|#.*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\x60[^\x60]*\x60|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g;
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
  const { t } = useTranslation("repositories");
  const [copied, setCopied] = useState(false);
  const firstLine = content.split("\n", 1)[0] ?? "";
  const language = repositoryLanguage(path, firstLine);
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const highlight = shouldHighlightRepositorySource(path, content);
  const copy = async () => {
    try { await navigator.clipboard.writeText(content); setCopied(true); }
    catch { setCopied(false); }
  };
  return <section className="repository-source" aria-label={t("repositories:source.ariaLabel")}>
    <header className="repository-source__toolbar">
      <div><strong>{path.split("/").at(-1)}</strong><span>{t("repositories:source.summary", { language, count: lines.length })}</span></div>
      <Button className="button secondary" onClick={() => void copy()} aria-label={t("repositories:source.copyAriaLabel")}>{copied ? <Check size={13}/> : <Copy size={13}/>} {copied ? t("repositories:source.copied") : t("repositories:source.copy")}</Button>
    </header>
    <pre className="repository-source__code"><code>{lines.map((line,index) => <span className={"repository-source__line" + (activeLine === index + 1 ? " repository-source__line--active" : "")} id={"line-" + (index + 1)} key={index}><span className="repository-source__number" aria-hidden="true">{index+1}</span><span className="repository-source__text">{highlight ? highlightLine(line) : line}</span></span>)}</code></pre>
  </section>;
}
