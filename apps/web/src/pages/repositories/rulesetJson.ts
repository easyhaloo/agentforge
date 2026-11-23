import type { RepositoryRefRule } from "../../shared/api/identity";

export const maxRulesetFileBytes = 64 * 1024;
const format = "agentforge-repository-ruleset-v1";
const ruleTypes = {
  restrict_creation: "creation",
  restrict_update: "update",
  restrict_deletion: "deletion",
  block_force_push: "non_fast_forward",
  require_pull_request: "pull_request",
} as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every(key => keys.includes(key));
}

function readPatterns(value: unknown, target: RepositoryRefRule["target"], native: boolean): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const patterns: string[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== "string") return undefined;
    if (item === "~ALL" || (item === "~DEFAULT_BRANCH" && target === "branch")) {
      patterns.push(item);
      continue;
    }
    if (native) {
      if (!item || item.trim() !== item || /[\r\n]/u.test(item)) return undefined;
      patterns.push(item);
      continue;
    }
    const prefix = target === "branch" ? "refs/heads/" : "refs/tags/";
    if (!item.startsWith(prefix)) return undefined;
    const ref = item.slice(prefix.length);
    // Import only the shared subset of GitHub fnmatch and AgentForge glob syntax.
    // In GitHub syntax a recursive ** must be followed by a slash.
    const segments = ref.split("/");
    if (!segments.every((segment, index) => (segment === "**" && index < segments.length - 1) ||
      (!segment.includes("**") && /^[a-zA-Z0-9_.?*-]+$/u.test(segment)))) return undefined;
    patterns.push(ref);
  }
  return patterns;
}

export function parseRulesetJson(text: string): RepositoryRefRule | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!record(value) || !hasOnlyKeys(value, ["schema", "id", "name", "target", "source", "source_type", "enforcement",
    "conditions", "rules", "bypass_actors", "node_id", "created_at", "updated_at", "current_user_can_bypass", "_links"])) return undefined;
  const { schema, name, target, enforcement, conditions, rules, bypass_actors: bypassActors } = value;
  if ((schema !== undefined && schema !== format) || typeof name !== "string" || !name || name.trim() !== name ||
    (target !== "branch" && target !== "tag") || (enforcement !== "active" && enforcement !== "disabled") ||
    (bypassActors !== undefined && (!Array.isArray(bypassActors) || bypassActors.length !== 0)) ||
    !record(conditions) || !hasOnlyKeys(conditions, ["ref_name"]) || !record(conditions.ref_name) ||
    !hasOnlyKeys(conditions.ref_name, ["include", "exclude"]) || !Array.isArray(rules) || !rules.length) return undefined;

  const include = readPatterns(conditions.ref_name.include, target, schema === format);
  const exclude = readPatterns(conditions.ref_name.exclude ?? [], target, schema === format);
  if (!include?.length || !exclude) return undefined;
  const types = new Set<string>();
  for (const rule of rules as unknown[]) {
    if (!record(rule) || !hasOnlyKeys(rule, ["type", "parameters"]) || typeof rule.type !== "string" ||
      !Object.values<string>(ruleTypes).includes(rule.type) || types.has(rule.type)) return undefined;
    if (rule.parameters !== undefined && (!record(rule.parameters) ||
      !hasOnlyKeys(rule.parameters, rule.type === "update" ? ["update_allows_fetch_and_merge"] : []) ||
      (rule.parameters.update_allows_fetch_and_merge !== undefined && rule.parameters.update_allows_fetch_and_merge !== false))) return undefined;
    types.add(rule.type);
  }
  if (target === "tag" && (types.has("non_fast_forward") || types.has("pull_request"))) return undefined;
  return {
    name, target, enabled: enforcement === "active", include, exclude,
    restrict_creation: types.has("creation"), restrict_update: types.has("update"),
    restrict_deletion: types.has("deletion"), block_force_push: types.has("non_fast_forward"),
    ...(types.has("pull_request") && { require_pull_request: true }),
  };
}

export function serializeRulesetJson(rule: RepositoryRefRule): string {
  return JSON.stringify({
    schema: format,
    name: rule.name,
    target: rule.target,
    enforcement: rule.enabled ? "active" : "disabled",
    conditions: { ref_name: { include: rule.include, exclude: rule.exclude } },
    rules: Object.entries(ruleTypes).flatMap(([key, type]) => rule[key as keyof typeof ruleTypes] ? [{ type }] : []),
  }, null, 2) + "\n";
}
