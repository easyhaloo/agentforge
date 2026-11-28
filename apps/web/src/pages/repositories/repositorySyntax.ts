import type { BundledLanguage, Highlighter, ThemedToken } from "shiki";

export type RepositorySyntaxResult = {
  tokens: ThemedToken[][];
  foreground: string;
  background: string;
};

const THEME = "github-dark";
const LIGHT_THEME = "github-light";
const THEME_FOREGROUND = "#e6edf3";
const THEME_BACKGROUND = "#0d1117";
let highlighterPromise: Promise<Highlighter> | undefined;
const languageLoads = new Map<string, Promise<void>>();

async function getRepositoryHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    const pending = import("shiki").then(({ getSingletonHighlighter }) =>
      getSingletonHighlighter({ langs: [], themes: [THEME, LIGHT_THEME] }),
    );
    highlighterPromise = pending;
    // A transient chunk/WASM load failure must not poison all later viewer requests.
    void pending.catch(() => {
      if (highlighterPromise === pending) highlighterPromise = undefined;
    });
  }
  return highlighterPromise;
}

/** Tokenize source with a shared Shiki instance; grammars are loaded only when first used. */
export async function highlightRepositorySource(
  source: string,
  language: string,
  adaptiveColors = false,
): Promise<RepositorySyntaxResult> {
  const highlighter = await getRepositoryHighlighter();
  let loading = languageLoads.get(language);
  if (!loading) {
    loading = highlighter.loadLanguage(language as BundledLanguage);
    languageLoads.set(language, loading);
    loading.catch(() => languageLoads.delete(language));
  }
  await loading;

  const lang = language as BundledLanguage;
  const result = highlighter.codeToTokens(source, adaptiveColors
    ? { lang, themes: { light: LIGHT_THEME, dark: THEME }, defaultColor: "light-dark()", colorsRendering: "none" }
    : { lang, theme: THEME });
  return {
    tokens: result.tokens,
    foreground: result.fg ?? THEME_FOREGROUND,
    background: result.bg ?? THEME_BACKGROUND,
  };
}
