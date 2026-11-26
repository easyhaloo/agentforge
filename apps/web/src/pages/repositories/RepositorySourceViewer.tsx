import { useEffect, useState, type CSSProperties } from "react";
import { Copy, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../shared/ui";
import { codeLanguageLabel, detectCodeLanguage } from "../../shared/code/languages";
import { highlightRepositorySource, type RepositorySyntaxResult } from "./repositorySyntax";

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

function tokenStyle(token: RepositorySyntaxResult["tokens"][number][number]): CSSProperties {
  if (token.htmlStyle && typeof token.htmlStyle !== "string") {
    return {
      color: token.htmlStyle.color,
      fontStyle: token.htmlStyle["--shiki-light-font-style"],
      fontWeight: token.htmlStyle["--shiki-light-font-weight"],
    };
  }
  const style: CSSProperties = {};
  if (token.color) style.color = token.color;
  if (token.fontStyle !== undefined) {
    if (token.fontStyle & 1) style.fontStyle = "italic";
    if (token.fontStyle & 2) style.fontWeight = 700;
  }
  return style;
}

function renderTokens(tokens: RepositorySyntaxResult["tokens"][number] | undefined) {
  if (!tokens?.length) return null;
  return tokens.map((token, index) => token.htmlStyle || token.color || token.fontStyle
    ? <span key={index} className="repository-code__shiki-token" style={tokenStyle(token)}>{token.content}</span>
    : <span key={index}>{token.content}</span>);
}

export function RepositorySourceViewer({ path, content, activeLine = 0 }: { path: string; content: string; activeLine?: number }) {
  const { t } = useTranslation("repositories");
  const [copied, setCopied] = useState(false);
  const [syntax, setSyntax] = useState<RepositorySyntaxResult | null>(null);
  const [highlightFailed, setHighlightFailed] = useState(false);
  const normalizedContent = content.replace(/\r\n?/g, "\n");
  const firstLine = normalizedContent.split("\n", 1)[0] ?? "";
  const language = repositoryLanguage(path, firstLine);
  const lines = normalizedContent.split("\n");
  const highlight = shouldHighlightRepositorySource(path, normalizedContent);

  useEffect(() => {
    let current = true;
    setSyntax(null);
    setHighlightFailed(false);
    if (!highlight) return () => { current = false; };

    // Plain text is rendered immediately. Shiki and its grammar are loaded asynchronously.
    void highlightRepositorySource(normalizedContent, detectCodeLanguage(path, firstLine)?.shiki ?? "", true)
      .then(result => { if (current) setSyntax(result); })
      .catch(() => { if (current) setHighlightFailed(true); });
    return () => { current = false; };
  }, [highlight, normalizedContent, path, firstLine]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(content); setCopied(true); }
    catch { setCopied(false); }
  };

  return <section className="repository-source" aria-label={t("repositories:source.ariaLabel")} data-highlight-engine={syntax ? "shiki" : "plain-text"} data-highlight-failed={highlightFailed || undefined}>
    <header className="repository-source__toolbar">
      <div><strong>{path.split("/").at(-1)}</strong><span>{t("repositories:source.summary", { language, count: lines.length })}</span></div>
      <Button className="button secondary" onClick={() => void copy()} aria-label={t("repositories:source.copyAriaLabel")}>{copied ? <Check size={13}/> : <Copy size={13}/>} {copied ? t("repositories:source.copied") : t("repositories:source.copy")}</Button>
    </header>
    <pre className="repository-source__code"><code>{lines.map((line,index) => <span className={"repository-source__line" + (activeLine === index + 1 ? " repository-source__line--active" : "")} id={"line-" + (index + 1)} key={index}><span className="repository-source__number" aria-hidden="true">{index+1}</span><span className="repository-source__text">{highlight && syntax ? renderTokens(syntax.tokens[index]) ?? line : line}</span></span>)}</code></pre>
  </section>;
}
