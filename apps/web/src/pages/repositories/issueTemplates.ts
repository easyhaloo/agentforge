import { parseDocument } from "yaml";
import { APIError } from "../../shared/api/errors";
import { repositoryPreviewAPI, type RepositoryPreviewEntry } from "../../shared/api/identity";

export type IssueTemplate = {
  filename: string;
  name: string;
  description: string;
  title: string;
  body: string;
  metadata: URLSearchParams;
  fields?: IssueFormField[];
};

type FieldBase = { id: string; label: string; description: string; required: boolean };
export type IssueFormField =
  | { type: "markdown"; value: string }
  | FieldBase & { type: "input" | "textarea"; value: string; placeholder: string; render: string }
  | FieldBase & { type: "dropdown"; options: string[]; multiple: boolean; selected: number }
  | FieldBase & { type: "checkboxes"; options: { label: string; required: boolean }[] }
  | FieldBase & { type: "upload"; accept: string };
export type IssueFormValues = Record<number, string[]>;

type ContactLink = { name: string; description: string; url: string };
export type IssueTemplates = { templates: IssueTemplate[]; contacts: ContactLink[]; blankEnabled: boolean; invalid: boolean };

function mapping(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : undefined;
}

function yamlMapping(source: string) {
  const document = parseDocument(source, { schema: "core" });
  if (document.errors.length) return undefined;
  try {
    return mapping(document.toJS({ maxAliasCount: 0 }));
  } catch {
    return undefined;
  }
}

function text(input: unknown): string {
  return typeof input === "string" ? input : "";
}

function list(input: unknown): string {
  return Array.isArray(input) ? input.filter((item): item is string => typeof item === "string").join(",") : text(input);
}

export function parseMarkdownTemplate(filename: string, source: string, legacy = false): IssueTemplate | undefined {
  const match = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m.exec(source);
  const frontMatter = match?.index === 0 ? match : undefined;
  const values = frontMatter ? yamlMapping(frontMatter[1]) : undefined;
  if (frontMatter && !values || !legacy && (!text(values?.name).trim() || !text(values?.about).trim())) return undefined;
  return {
    filename,
    name: text(values?.name).trim(),
    description: text(values?.about).trim(),
    title: text(values?.title),
    body: frontMatter ? source.slice(frontMatter[0].length).replace(/^\r?\n/, "") : source,
    metadata: templateMetadata(values),
  };
}

function templateMetadata(values?: Record<string, unknown>) {
  const metadata = new URLSearchParams();
  for (const key of ["labels", "assignees", "type", "projects"] as const) {
    const value = list(values?.[key]);
    if (value.trim()) metadata.set(key, value);
  }
  return metadata;
}

function parseFormField(value: unknown): IssueFormField | undefined {
  const raw = mapping(value);
  const attributes = mapping(raw?.attributes);
  const validations = mapping(raw?.validations);
  if (!raw || !attributes) return;
  const type = raw.type;
  if (type === "markdown") {
    const value = text(attributes.value);
    return value.trim() ? { type, value } : undefined;
  }
  const label = text(attributes.label).trim();
  if (!label || /[\r\n]/.test(label)) return;
  const id = text(raw.id);
  if (raw.id !== undefined && !/^[a-z0-9_-]+$/i.test(id)) return;
  const base = { id, label, description: text(attributes.description), required: validations?.required === true };
  if (type === "input" || type === "textarea") {
    const render = type === "textarea" ? text(attributes.render).trim() : "";
    if (render && !/^[a-z0-9_+#.-]+$/i.test(render)) return;
    return { ...base, type, value: text(attributes.value), placeholder: text(attributes.placeholder), render };
  }
  if (type === "upload") return { ...base, type, accept: text(validations?.accept) };
  const choices: unknown[] = Array.isArray(attributes.options) ? attributes.options : [];
  if (!choices.length) return;
  if (type === "dropdown") {
    const options = choices.map((item) => text(item).trim());
    if (options.some((item) => !item) || new Set(options).size !== options.length) return;
    const selected = attributes.default ?? -1;
    if (typeof selected !== "number" || !Number.isInteger(selected) || selected < -1 || selected >= options.length) return;
    return { ...base, type, options, selected, multiple: attributes.multiple === true };
  }
  if (type === "checkboxes") {
    const options = choices.map((item) => {
      const option = mapping(item);
      return { label: text(option?.label).trim(), required: option?.required === true };
    });
    if (options.some((option) => !option.label || /[\r\n]/.test(option.label))) return;
    return { ...base, type, options };
  }
}

export function parseIssueForm(filename: string, source: string): IssueTemplate | undefined {
  const values = yamlMapping(source);
  const name = text(values?.name).trim();
  const description = text(values?.description).trim();
  if (!name || !description || !Array.isArray(values?.body)) return;
  const fields: IssueFormField[] = [];
  const ids = new Set<string>();
  for (const raw of values.body as unknown[]) {
    const field = parseFormField(raw);
    if (!field) return;
    if (field.type !== "markdown" && field.id) {
      if (ids.has(field.id)) return;
      ids.add(field.id);
    }
    fields.push(field);
  }
  if (!fields.some((field) => field.type !== "markdown")) return;
  return { filename, name, description, title: text(values.title), body: "", metadata: templateMetadata(values), fields };
}

const composerParameters = new Set(["template", "title", "body", "labels", "assignees", "milestone", "type", "projects"]);

export function initialIssueForm(fields: IssueFormField[], params?: URLSearchParams, textLimit = Infinity): IssueFormValues {
  const values: IssueFormValues = {};
  fields.forEach((field, index) => {
    if (field.type === "input" || field.type === "textarea") {
      const prefill = field.id && !composerParameters.has(field.id) ? params?.get(field.id) : undefined;
      const value = (prefill ?? field.value).slice(0, textLimit);
      if (value) values[index] = [field.type === "input" ? value.replace(/[\r\n]/g, "") : value];
    }
    if (field.type === "dropdown" && field.selected >= 0) values[index] = [field.options[field.selected]];
  });
  return values;
}

export function missingIssueFormFields(fields: IssueFormField[], values: IssueFormValues): number[] {
  return fields.flatMap((field, index) => {
    if (field.type === "markdown") return [];
    const answers = values[index] ?? [];
    const missing = field.required && !answers.some((answer) => answer.trim());
    const unchecked = field.type === "checkboxes" && field.options.some((option, position) =>
      option.required && !answers.includes(String(position)));
    return missing || unchecked ? [index] : [];
  });
}

export function renderIssueForm(fields: IssueFormField[], values: IssueFormValues, noResponse: string): string {
  return fields.flatMap((field, index) => {
    if (field.type === "markdown") return [];
    const answers = values[index] ?? [];
    let content = answers.join(field.type === "dropdown" ? ", " : "\n").trim() || noResponse;
    if (field.type === "checkboxes") {
      content = field.options.map((option, position) =>
        `- [${answers.includes(String(position)) ? "x" : " "}] ${option.label}`).join("\n");
    }
    if (field.type === "textarea" && field.render && answers[0]?.trim()) {
      const longest = Math.max(2, ...Array.from(answers[0].matchAll(/`+/g), ([ticks]) => ticks.length));
      const fence = "`".repeat(longest + 1);
      content = `${fence}${field.render}\n${answers[0]}\n${fence}`;
    }
    const heading = field.label.replace(/[\\`*_\[\]<>#]/g, "\\$&");
    return [`### ${heading}\n\n${content}`];
  }).join("\n\n");
}

function parseContacts(value: unknown): ContactLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    const fields = mapping(entry);
    const name = text(fields?.name).trim();
    const description = text(fields?.about).trim();
    const url = text(fields?.url).trim();
    if (!name || !description || !URL.canParse(url)) return [];
    return /^https?:$/.test(new URL(url).protocol) ? [{ name, description, url }] : [];
  });
}

const templateDirectory = "ISSUE_TEMPLATE";
const maxTemplateSize = 1 << 16;

export async function loadIssueTemplates(organizationID: string, repository: string): Promise<IssueTemplates> {
  const result: IssueTemplates = { templates: [], contacts: [], blankEnabled: true, invalid: false };
  const root = await repositoryPreviewAPI.tree(organizationID, repository).catch((cause: unknown) => {
    if (cause instanceof APIError && cause.status === 404) return undefined;
    throw cause;
  });
  if (!root) return result;
  const commit = root.commit_sha;
  const tree = async (path: string) => (await repositoryPreviewAPI.tree(organizationID, repository, path, commit)).items ?? [];
  const blob = async (entry: RepositoryPreviewEntry) => (await repositoryPreviewAPI.blob(organizationID, repository, entry.path, commit)).content;
  const directories = (root.items ?? []).filter((entry) => entry.kind === "tree").map((entry) => entry.name);
  const [github, docs] = await Promise.all([".github", "docs"].map((dir) => directories.includes(dir) ? tree(dir) : []));
  const locations = [github, root.items ?? [], docs];
  const templateLists = await Promise.all(locations.map((entries) => {
    const dir = entries.find((entry) => entry.kind === "tree" && entry.name === templateDirectory);
    return dir ? tree(dir.path) : [];
  }));
  const seen = new Set<string>();
  for (const entries of templateLists) {
    const config = entries.find((entry) => entry.name === "config.yml" || entry.name === "config.yaml");
    if (config && !seen.has("config")) {
      seen.add("config");
      const values = config.kind === "file" && (config.size ?? 0) <= maxTemplateSize ? yamlMapping(await blob(config)) : undefined;
      result.invalid = !values;
      result.blankEnabled = values?.blank_issues_enabled !== false;
      result.contacts = parseContacts(values?.contact_links);
    }
    const isForm = (name: string) => /\.ya?ml$/i.test(name);
    const files = entries.filter((entry) => {
      if (/^config\.ya?ml$/i.test(entry.name) || entry.kind !== "file" || !/\.(?:md|ya?ml)$/i.test(entry.name) || seen.has(entry.name)) return false;
      seen.add(entry.name);
      return true;
    });
    files.sort((a, b) => Number(isForm(b.name)) - Number(isForm(a.name)) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (let index = 0; index < files.length; index += 8) {
      const templates = await Promise.all(files.slice(index, index + 8).map(async (entry) => {
        if ((entry.size ?? 0) > maxTemplateSize) return undefined;
        const parse = isForm(entry.name) ? parseIssueForm : parseMarkdownTemplate;
        return parse(entry.name, await blob(entry));
      }));
      for (const template of templates) {
        if (template) result.templates.push(template);
        else result.invalid = true;
      }
    }
  }
  if (!result.templates.length) {
    const legacyFile = (entries: RepositoryPreviewEntry[]) => entries.find((entry) => entry.kind === "file" && /^issue_template\.md$/i.test(entry.name));
    const legacy = legacyFile(github) ?? legacyFile(root.items ?? []) ?? legacyFile(docs);
    if (legacy) {
      const template = (legacy.size ?? 0) <= maxTemplateSize ? parseMarkdownTemplate(legacy.name, await blob(legacy), true) : undefined;
      if (template) result.templates.push(template);
      else result.invalid = true;
    }
  }
  return result;
}
