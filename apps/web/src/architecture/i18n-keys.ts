import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The translation consistency checker.
 *
 * It answers three questions that a human reviewer cannot answer reliably across a codebase
 * this size: does every key the code asks for exist, do the shipped languages agree on the key
 * set, and do they agree on the interpolation placeholders inside a key.
 */

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localesRoot = resolve(sourceRoot, "locales");

/** The languages the app ships translations for. */
export const shippedLanguages = ["en-US", "zh-CN"] as const;

/** The namespace i18next falls back to when a key carries no explicit namespace. */
export const defaultNamespace = "common";

export type LocaleTree = Record<string, unknown>;

/** Every locale file of one language, keyed by namespace (the file name without extension). */
export function readLocaleFiles(language: string): Record<string, LocaleTree> {
  const directory = resolve(localesRoot, language);
  const files: Record<string, LocaleTree> = {};
  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith(".json")) continue;
    files[entry.replace(/\.json$/, "")] = JSON.parse(readFileSync(resolve(directory, entry), "utf8")) as LocaleTree;
  }
  return files;
}

/** Every leaf key of a locale tree, as dotted paths. */
export function flattenKeys(tree: LocaleTree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([name, value]) => {
    const path = prefix ? `${prefix}.${name}` : name;
    if (value && typeof value === "object" && !Array.isArray(value)) return flattenKeys(value as LocaleTree, path);
    return [path];
  });
}

/** The `{{placeholder}}` names a translation string interpolates, sorted for comparison. */
export function placeholdersOf(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((match) => match[1]).sort();
}

/** The plural categories a language can select, e.g. English selects "one" and "other". */
export function pluralCategories(language: string): string[] {
  return new Intl.PluralRules(language).resolvedOptions().pluralCategories;
}

/** The value behind a dotted key path, or undefined when the path does not resolve. */
function lookup(tree: LocaleTree, key: string): unknown {
  return key.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, tree);
}

/** Whether a namespace tree defines a key, either directly or through a plural variant. */
export function hasKey(tree: LocaleTree, key: string, language: string): boolean {
  if (typeof lookup(tree, key) === "string") return true;
  const categories = pluralCategories(language);
  // i18next resolves `key` to `key_<category>` when the caller passes a count.
  return categories.some((category) => typeof lookup(tree, `${key}_${category}`) === "string");
}

/** Whether a namespace tree defines every plural variant a language can select for a key. */
export function hasEveryPluralVariant(tree: LocaleTree, key: string, language: string): boolean {
  if (typeof lookup(tree, key) === "string") return true;
  const categories = pluralCategories(language);
  return categories.every((category) => typeof lookup(tree, `${key}_${category}`) === "string");
}

/** The raw string behind a key, following the plural suffix a language would select. */
export function resolveValue(tree: LocaleTree, key: string, language: string): string | undefined {
  const direct = lookup(tree, key);
  if (typeof direct === "string") return direct;
  for (const category of pluralCategories(language)) {
    const value = lookup(tree, `${key}_${category}`);
    if (typeof value === "string") return value;
  }
  return undefined;
}

/** A `t("...")` call found in the source. */
export type KeyReference = {
  /** The fully qualified key, e.g. `settings:keys.daysAgo`. */
  key: string;
  /** The namespace the key belongs to. */
  namespace: string;
  /** Whether the call passes a `count`, which makes i18next look for a plural variant. */
  plural: boolean;
  /** The file the call was found in, relative to `src`. */
  file: string;
};

/** Every source file that can call `t`, excluding the locale files themselves and the tests. */
function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "locales") return [];
      return collectSourceFiles(path);
    }
    if (!/\.tsx?$/.test(path)) return [];
    if (/\.test\.tsx?$/.test(path)) return [];
    return [path];
  });
}

/** The namespaces a file's `useTranslation()` calls bind, defaulting to the i18next default. */
function namespacesOf(source: string): string[] {
  const namespaces = new Set<string>();
  for (const match of source.matchAll(/useTranslation\(\s*([^)]*)\)/g)) {
    const argumentsText = match[1];
    const quoted = [...argumentsText.matchAll(/["']([^"']+)["']/g)].map((entry) => entry[1]);
    if (quoted.length === 0) namespaces.add(defaultNamespace);
    for (const namespace of quoted) namespaces.add(namespace);
  }
  return [...namespaces];
}

/** The options of a `t` call, up to the closing parenthesis of that call. */
function callOptions(source: string, callStart: number): string {
  const closing = source.indexOf(")", callStart);
  return source.slice(callStart, closing === -1 ? callStart + 300 : closing);
}

/** The namespace a `t` call targets, taking the explicit `ns` option before the hook's namespace. */
function namespaceOfCall(options: string, candidates: string[]): string {
  const explicit = options.match(/\bns\s*:\s*["']([^"']+)["']/);
  if (explicit) return explicit[1];
  return candidates[0] ?? defaultNamespace;
}

/**
 * Blanks out comments so that a `t("...")` written in a doc comment is not read as a call.
 *
 * Strings are consumed before comments, so a URL inside a string keeps its `//`. The blanked
 * text keeps its line breaks so that reported positions stay meaningful.
 */
function stripComments(source: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  let result = "";
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index);
      const stop = end === -1 ? source.length : end;
      result += blank(source.slice(index, stop));
      index = stop;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      result += blank(source.slice(index, stop));
      index = stop;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      let end = index + 1;
      while (end < source.length) {
        if (source[end] === "\\") {
          end += 2;
          continue;
        }
        if (source[end] === char) break;
        // A quote that never closes on its line is an apostrophe in prose, not a string.
        if (char !== "`" && source[end] === "\n") break;
        end += 1;
      }
      const stop = Math.min(end + 1, source.length);
      result += source.slice(index, stop);
      index = stop;
      continue;
    }

    result += char;
    index += 1;
  }

  return result;
}

export function collectKeyReferences(): KeyReference[] {
  const references: KeyReference[] = [];

  for (const file of collectSourceFiles(sourceRoot)) {
    const source = stripComments(readFileSync(file, "utf8"));
    const candidates = namespacesOf(source);
    const filePath = relative(sourceRoot, file);

    for (const match of source.matchAll(/\bt\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)) {
      const literal = match[1].slice(1, -1);
      if (literal.includes("${")) continue; // A template literal with a runtime value cannot be checked.

      const options = callOptions(source, match.index + match[0].length);
      const plural = /\bcount\s*:/.test(options);

      let namespace = namespaceOfCall(options, candidates);
      let key = literal;
      const separator = literal.indexOf(":");
      if (separator > -1) {
        namespace = literal.slice(0, separator);
        key = literal.slice(separator + 1);
      }

      references.push({ key: `${namespace}:${key}`, namespace, plural, file: filePath });
    }
  }

  return references;
}

/** The `{{placeholder}}` names inside a key, for every language that defines it. */
export function placeholdersByKey(language: string): Map<string, string[]> {
  const placeholders = new Map<string, string[]>();
  for (const [namespace, tree] of Object.entries(readLocaleFiles(language))) {
    for (const key of flattenKeys(tree)) {
      const value = resolveValue(tree, key, language);
      if (value !== undefined) placeholders.set(`${namespace}:${key}`, placeholdersOf(value));
    }
  }
  return placeholders;
}

/** The namespaces the app ships, read from the i18next setup. */
export function shippedNamespaces(): string[] {
  const source = readFileSync(resolve(localesRoot, "index.ts"), "utf8");
  const declaration = source.match(/ns:\s*\[([^\]]*)\]/);
  if (!declaration) return [];
  return [...declaration[1].matchAll(/["']([^"']+)["']/g)].map((entry) => entry[1]);
}
