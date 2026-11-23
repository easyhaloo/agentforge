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

  it("imports a GitHub pull-request rule without extra requirements", () => {
    expect(githubImport({ rules: [{ type: "pull_request", parameters: {} }] })).toMatchObject({ require_pull_request: true });
  });

  it.each([
    { rules: [{ type: "pull_request", parameters: { required_approving_review_count: 2 } }] },
    { target: "tag", conditions: { ref_name: { include: ["~ALL"] } }, rules: [{ type: "pull_request" }] },
    { bypass_actors: [{ actor_id: 5, bypass_mode: "always" }] },
    { enforcement: "evaluate" },
    { conditions: { ...githubRuleset.conditions, repository_name: { include: ["restricted-*"], exclude: [] } } },
    { conditions: { ref_name: { include: ["refs/heads/releases/**"] } } },
    { conditions: { ref_name: { include: ["refs/tags/wrong-target"] } } },
    { rules: [{ type: "update", parameters: { update_allows_fetch_and_merge: true } }] },
    { target: "tag", conditions: { ref_name: { include: ["~ALL"] } } },
  ])("rejects unsupported semantics instead of importing a partial rule %#", (overrides) => {
    expect(githubImport(overrides)).toBeUndefined();
  });

  it("rejects invalid JSON and multi-rule exports", () => {
    expect(parseRulesetJson("{")).toBeUndefined();
    expect(parseRulesetJson(JSON.stringify([githubRuleset]))).toBeUndefined();
  });
});
