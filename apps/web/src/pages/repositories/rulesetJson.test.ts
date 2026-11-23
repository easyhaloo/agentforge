import { describe, expect, it } from "vitest";
import type { RepositoryRefRule } from "../../shared/api/identity";
import { parseRulesetJson, serializeRulesetJson } from "./rulesetJson";

const githubRuleset = {
  id: 421,
  name: "Release protection",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["refs/heads/releases/**/*", "~DEFAULT_BRANCH"], exclude: ["refs/heads/releases/dev/*"] } },
  rules: [{ type: "deletion" }, { type: "non_fast_forward" }],
  bypass_actors: [],
};

function githubImport(overrides: object) {
  return parseRulesetJson(JSON.stringify({ ...githubRuleset, ...overrides }));
}

describe("ruleset JSON portability", () => {
  it("round trips a disabled native ruleset with recursive globs", () => {
    const rule: RepositoryRefRule = {
      name: "Release refs", target: "branch", enabled: false, include: ["releases/**", "~DEFAULT_BRANCH"],
      exclude: ["releases/scratch/**"], restrict_creation: true, restrict_update: false,
      restrict_deletion: false, block_force_push: true, require_pull_request: true,
    };
    expect(parseRulesetJson(serializeRulesetJson(rule))).toEqual(rule);
  });

  it("imports equivalent GitHub ref conditions and restrictions", () => {
    expect(githubImport({})).toEqual({
      name: "Release protection", target: "branch", enabled: true,
      include: ["releases/**/*", "~DEFAULT_BRANCH"], exclude: ["releases/dev/*"],
      restrict_creation: false, restrict_update: false, restrict_deletion: true, block_force_push: true,
    });
  });

  it("imports GitHub pull-request parameters covered by AgentForge's active revision review", () => {
    const parameters = {
      required_approving_review_count: 1, dismiss_stale_reviews_on_push: true, require_code_owner_review: false,
      require_last_push_approval: false, required_review_thread_resolution: false,
      allowed_merge_methods: ["merge", "squash", "rebase"], required_reviewers: [],
      require_extra_approval_for_unattributed_changes: false,
    };
    expect(githubImport({ rules: [{ type: "pull_request", parameters }] })).toMatchObject({ require_pull_request: true });
  });

  it("imports and exports only parameterless linear history rules on branches", () => {
    const rules = [{ type: "required_linear_history", parameters: {} }];
    const rule = githubImport({ rules });
    expect(rule?.require_linear_history).toBe(true);
    expect(rule && parseRulesetJson(serializeRulesetJson(rule))).toEqual(rule);
    expect(githubImport({ target: "tag", conditions: { ref_name: { include: ["~ALL"] } }, rules })).toBeUndefined();
    expect(githubImport({ rules: [{ type: "required_linear_history", parameters: { unexpected: true } }] })).toBeUndefined();
  });

  it("round trips GitHub tag force-push protection and name patterns", () => {
    const rules = [
      { type: "non_fast_forward" },
      { type: "tag_name_pattern", parameters: { operator: "starts_with", pattern: "v", name: "Version prefix" } },
      { type: "tag_name_pattern", parameters: { operator: "regex", pattern: "-draft$", negate: true } },
    ];
    const rule = githubImport({ target: "tag", conditions: { ref_name: { include: ["~ALL"] } }, rules });
    expect(rule?.block_force_push).toBe(true);
    expect(rule?.name_patterns).toEqual(rules.slice(1).map(({ parameters }) => parameters));
    expect(rule && parseRulesetJson(serializeRulesetJson(rule))).toEqual(rule);
    expect(githubImport({ rules })).toBeUndefined();
  });

  it.each([
    { rules: [{ type: "pull_request", parameters: { required_approving_review_count: 2 } }] },
    { rules: [{ type: "pull_request", parameters: { require_code_owner_review: true } }] },
    { rules: [{ type: "pull_request", parameters: { require_last_push_approval: true } }] },
    { rules: [{ type: "pull_request", parameters: { require_extra_approval_for_unattributed_changes: true } }] },
    { rules: [{ type: "pull_request", parameters: { required_review_thread_resolution: true } }] },
    { rules: [{ type: "pull_request", parameters: { allowed_merge_methods: ["squash"] } }] },
    { target: "tag", conditions: { ref_name: { include: ["~ALL"] } }, rules: [{ type: "pull_request" }] },
    { bypass_actors: [{ actor_id: 5, bypass_mode: "always" }] },
    { enforcement: "evaluate" },
    { conditions: { ...githubRuleset.conditions, repository_name: { include: ["restricted-*"], exclude: [] } } },
    { conditions: { ref_name: { include: ["refs/heads/releases/**"] } } },
    { conditions: { ref_name: { include: ["refs/tags/wrong-target"] } } },
    { rules: [{ type: "update", parameters: { update_allows_fetch_and_merge: true } }] },
    { target: "tag", conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } } },
  ])("rejects unsupported semantics instead of importing a partial rule %#", (overrides) => {
    expect(githubImport(overrides)).toBeUndefined();
  });

  it("rejects invalid JSON and multi-rule exports", () => {
    expect(parseRulesetJson("{")).toBeUndefined();
    expect(parseRulesetJson(JSON.stringify([githubRuleset]))).toBeUndefined();
  });
});
