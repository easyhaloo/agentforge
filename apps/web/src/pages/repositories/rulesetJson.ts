import type { PullRequestMergeMethod, RefNamePattern, RepositoryRefRule } from "../../shared/api/identity";

export const maxRulesetFileBytes = 64 * 1024;
const format = "agentforge-repository-ruleset-v1";
export const mergeMethods = ["merge", "squash", "rebase"] as const;
export const namePatternOperators = ["starts_with", "ends_with", "contains", "regex"] as const;
const ruleTypes = {
  restrict_creation: "creation",
  restrict_update: "update",
  restrict_deletion: "deletion",
  block_force_push: "non_fast_forward",
  require_linear_history: "required_linear_history",
  require_pull_request: "pull_request",
  require_merge_queue: "merge_queue",
} as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every(key => keys.includes(key));
}

function supportedRuleParameters(type: string, value: unknown): boolean {
  if (value === undefined) return true;
  if (!record(value)) return false;
  if (type === "update") {
    return hasOnlyKeys(value, ["update_allows_fetch_and_merge"]) &&
      (value.update_allows_fetch_and_merge === undefined || value.update_allows_fetch_and_merge === false);
  }
  return hasOnlyKeys(value, []);
}

function readPullRequestParameters(value: unknown): Pick<RepositoryRefRule, "allowed_merge_methods"> | undefined {
  if (value === undefined) return {};
  if (!record(value)) return undefined;

  // AgentForge requires approval on the active revision, even when the source
  // ruleset permits zero approvals or allows approvals from older revisions.
  const { required_approving_review_count: count, dismiss_stale_reviews_on_push: dismissStale,
    require_code_owner_review: codeOwners, require_last_push_approval: lastPush,
    required_review_thread_resolution: resolveThreads, allowed_merge_methods: methods,
    required_reviewers: reviewers, require_extra_approval_for_unattributed_changes: extraApproval } = value;
  const supported = hasOnlyKeys(value, ["required_approving_review_count", "dismiss_stale_reviews_on_push", "require_code_owner_review",
    "require_last_push_approval", "required_review_thread_resolution", "allowed_merge_methods", "required_reviewers",
    "require_extra_approval_for_unattributed_changes"]) &&
    (count === undefined || count === 0 || count === 1) &&
    (dismissStale === undefined || typeof dismissStale === "boolean") &&
    [codeOwners, lastPush, resolveThreads, extraApproval].every(setting => setting === undefined || setting === false) &&
    (reviewers === undefined || (Array.isArray(reviewers) && reviewers.length === 0));
  if (!supported) return undefined;
  if (methods === undefined) return {};
  if (!Array.isArray(methods) || methods.length === 0 || new Set(methods).size !== methods.length ||
    !methods.every((method: unknown): method is PullRequestMergeMethod => mergeMethods.some(option => option === method))) return undefined;
  return { allowed_merge_methods: methods };
}

function readNamePattern(value: unknown): RefNamePattern | undefined {
  if (!record(value) || !hasOnlyKeys(value, ["operator", "pattern", "negate", "name"])) return undefined;
  const { operator, pattern, negate, name } = value;
  const allowedOperator = namePatternOperators.find(item => item === operator);
  if (!allowedOperator || typeof pattern !== "string" || !pattern ||
    (negate !== undefined && typeof negate !== "boolean") || (name !== undefined && typeof name !== "string")) return undefined;
  return { operator: allowedOperator, pattern, ...(negate && { negate }), ...(name && { name }) };
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
  const namePatterns: RefNamePattern[] = [];
  let queueMethod: RepositoryRefRule["merge_queue_method"];
  let pullRequestParameters: Pick<RepositoryRefRule, "allowed_merge_methods"> | undefined;
  for (const rule of rules as unknown[]) {
    if (!record(rule) || !hasOnlyKeys(rule, ["type", "parameters"]) || typeof rule.type !== "string") return undefined;
    if (rule.type === `${target}_name_pattern`) {
      const pattern = readNamePattern(rule.parameters);
      if (!pattern) return undefined;
      namePatterns.push(pattern);
      continue;
    }
    if (!Object.values<string>(ruleTypes).includes(rule.type) || types.has(rule.type)) return undefined;
    if (rule.type === "merge_queue" && rule.parameters !== undefined) {
      const parameters = rule.parameters;
      if (!record(parameters) || !hasOnlyKeys(parameters, ["merge_method"])) return undefined;
      const method = parameters.merge_method;
      if (method !== undefined) {
        queueMethod = mergeMethods.find(option => option.toUpperCase() === method);
        if (!queueMethod) return undefined;
      }
    } else if (rule.type === "pull_request") {
      pullRequestParameters = readPullRequestParameters(rule.parameters);
      if (!pullRequestParameters) return undefined;
    } else if (!supportedRuleParameters(rule.type, rule.parameters)) return undefined;
    types.add(rule.type);
  }
  if (target === "tag" && (types.has("required_linear_history") || types.has("pull_request") || types.has("merge_queue"))) return undefined;
  if (types.has("merge_queue") && (include.length !== 1 || include[0] !== "~DEFAULT_BRANCH" || exclude.length)) return undefined;
  return {
    name, target, enabled: enforcement === "active", include, exclude,
    restrict_creation: types.has("creation"), restrict_update: types.has("update"),
    restrict_deletion: types.has("deletion"), block_force_push: types.has("non_fast_forward"),
    ...(types.has("required_linear_history") && { require_linear_history: true }),
    ...(pullRequestParameters && { require_pull_request: true, ...pullRequestParameters }),
    ...(types.has("merge_queue") && { require_merge_queue: true }),
    ...(queueMethod && { merge_queue_method: queueMethod }),
    ...(namePatterns.length > 0 && { name_patterns: namePatterns }),
  };
}

export function serializeRulesetJson(rule: RepositoryRefRule): string {
  return JSON.stringify({
    schema: format,
    name: rule.name,
    target: rule.target,
    enforcement: rule.enabled ? "active" : "disabled",
    conditions: { ref_name: { include: rule.include, exclude: rule.exclude } },
    rules: [
      ...Object.entries(ruleTypes).flatMap(([key, type]) => rule[key as keyof typeof ruleTypes] ? [{
        type,
        ...(type === "pull_request" && rule.target === "branch" && rule.allowed_merge_methods && { parameters: { allowed_merge_methods: rule.allowed_merge_methods } }),
        ...(type === "merge_queue" && rule.merge_queue_method && { parameters: { merge_method: rule.merge_queue_method.toUpperCase() } }),
      }] : []),
      ...(rule.name_patterns ?? []).map(parameters => ({ type: `${rule.target}_name_pattern`, parameters })),
    ],
  }, null, 2) + "\n";
}
