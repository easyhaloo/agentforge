export type CodeLanguage = {
  id: string;
  label: string;
  shiki: string;
  monaco: string;
  extensions: readonly string[];
  filenames?: readonly string[];
  shebangs?: readonly RegExp[];
};

const definitions: readonly CodeLanguage[] = [
  { id:"typescript", label:"TypeScript", shiki:"typescript", monaco:"typescript", extensions:["ts","mts","cts"], shebangs:[/\b(?:ts-node|tsx)\b/] },
  { id:"tsx", label:"TSX", shiki:"tsx", monaco:"typescript", extensions:["tsx"] },
  { id:"javascript", label:"JavaScript", shiki:"javascript", monaco:"javascript", extensions:["js","mjs","cjs","jsx"], shebangs:[/\b(?:node|deno)\b/] },
  { id:"json", label:"JSON", shiki:"json", monaco:"json", extensions:["json","jsonc"] },
  { id:"python", label:"Python", shiki:"python", monaco:"python", extensions:["py","pyw"], filenames:["SConstruct","SConscript"], shebangs:[/\bpython(?:\d(?:\.\d+)*)?\b/] },
  { id:"go", label:"Go", shiki:"go", monaco:"go", extensions:["go"] },
  { id:"rust", label:"Rust", shiki:"rust", monaco:"rust", extensions:["rs"] },
  { id:"java", label:"Java", shiki:"java", monaco:"java", extensions:["java"] },
  { id:"cpp", label:"C++", shiki:"cpp", monaco:"cpp", extensions:["cc","cpp","cxx","hpp","hh","hxx"] },
  { id:"c", label:"C", shiki:"c", monaco:"c", extensions:["c","h"] },
  { id:"csharp", label:"C#", shiki:"csharp", monaco:"csharp", extensions:["cs"] },
  { id:"css", label:"CSS", shiki:"css", monaco:"css", extensions:["css"] },
  { id:"html", label:"HTML", shiki:"html", monaco:"html", extensions:["html","htm"] },
  { id:"xml", label:"XML", shiki:"xml", monaco:"xml", extensions:["xml","xsl","xslt"] },
  { id:"markdown", label:"Markdown", shiki:"markdown", monaco:"markdown", extensions:["md","mdx","markdown"] },
  { id:"yaml", label:"YAML", shiki:"yaml", monaco:"yaml", extensions:["yaml","yml"] },
  { id:"toml", label:"TOML", shiki:"toml", monaco:"ini", extensions:["toml"] },
  { id:"sql", label:"SQL", shiki:"sql", monaco:"sql", extensions:["sql"] },
  { id:"shell", label:"Shell", shiki:"bash", monaco:"shell", extensions:["sh","bash","zsh"], filenames:[".bashrc",".zshrc"], shebangs:[/\b(?:ba|z|da|k)?sh\b/] },
  { id:"dockerfile", label:"Dockerfile", shiki:"dockerfile", monaco:"dockerfile", extensions:[], filenames:["Dockerfile","Containerfile"] },
  { id:"makefile", label:"Makefile", shiki:"make", monaco:"makefile", extensions:[], filenames:["Makefile","GNUmakefile"] },
];

const byExtension = new Map<string, CodeLanguage>();
const byFilename = new Map<string, CodeLanguage>();
for (const language of definitions) {
  for (const extension of language.extensions) byExtension.set(extension, language);
  for (const filename of language.filenames ?? []) byFilename.set(filename.toLowerCase(), language);
}

export function detectCodeLanguage(path: string, firstLine = ""): CodeLanguage | undefined {
  const basename = path.split(/[\\/]/).at(-1) ?? path;
  const named = byFilename.get(basename.toLowerCase());
  if (named) return named;
  const extension = basename.includes(".") ? basename.split(".").at(-1)?.toLowerCase() : undefined;
  if (extension) {
    const language = byExtension.get(extension);
    if (language) return language;
  }
  if (firstLine.startsWith("#!")) {
    return definitions.find(language => language.shebangs?.some(pattern => pattern.test(firstLine)));
  }
  return undefined;
}

export function codeLanguageLabel(path: string, firstLine = ""): string {
  return detectCodeLanguage(path, firstLine)?.label ?? (path.split(/[\\/]/).at(-1) || "Text");
}

export function listCodeLanguages(): readonly CodeLanguage[] {
  return definitions;
}
