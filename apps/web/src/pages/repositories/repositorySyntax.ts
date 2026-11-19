import type { BundledLanguage, Highlighter, ThemedToken } from "shiki";

export type RepositorySyntaxResult = {
  tokens: ThemedToken[][];
  foreground: string;
  background: string;
};

const THEME = "github-dark";
let highlighterPromise: Promise<Highlighter> | undefined;
const languageLoads = new Map<string, Promise<void>>();

async function getRepositoryHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= import("shiki").then(({ getSingletonHighlighter }) =>
    getSingletonHighlighter({ langs: [], themes: [THEME] }),
  );
  return highlighterPromise;
}

/** Tokenize source with a shared Shiki instance; grammars are loaded only when first used. */
export async function highlightRepositorySource(
  source: string,
  language: string,
): Promise<RepositorySyntaxResult> {
  const highlighter = await getRepositoryHighlighter();
  let loading = languageLoads.get(language);
  if (!loading) {
    loading = highlighter.loadLanguage(language as BundledLanguage);
    languageLoads.set(language, loading);
    loading.catch(() => languageLoads.delete(language));
  }
  await loading;

  const result = highlighter.codeToTokens(source, { lang: language as BundledLanguage, theme: THEME });
  return {
    tokens: result.tokens,
    foreground: result.fg,
    background: result.bg,
  };
}
