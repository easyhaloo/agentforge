import { describe, expect, it } from "vitest";
import {
  canApproveRevision,
  canCreateRevision,
  canEditChangeset,
  canMergeRevision,
  canRunEvaluation,
  isEvidenceCurrent,
  isReviewCurrent,
  revisionKey,
} from "./index";

describe("revision-scoped delivery invariants", () => {
  const current = revisionKey("CS-2481", 4);
  const passed = {
    id: "EVL-1", revisionId: current, status: "Passed" as const, checks: 38, createdAt: "now",
  };
  const approved = { id: "REV-1", revisionId: current, decision: "Approved" as const, reviewer: "Mina" };
  const draft = { status: "Draft" as const };
  const merged = { status: "Merged" as const };

  it("keeps changeset identity separate from revision identity", () => {
    expect(revisionKey("CS-2481", 3)).not.toBe(revisionKey("CS-2481", 4));
  });

  it("marks evidence and review decisions from older revisions stale", () => {
    expect(isEvidenceCurrent(current, { ...passed, revisionId: "CS-2481@r3" })).toBe(false);
    expect(isReviewCurrent(current, { ...approved, revisionId: "CS-2481@r3" })).toBe(false);
  });

  it("requires passing evidence for the current revision before approval", () => {
    expect(canApproveRevision(current, passed)).toBe(true);
    expect(canApproveRevision(current, { ...passed, status: "Failed" })).toBe(false);
    expect(canApproveRevision(current, { ...passed, revisionId: "CS-2481@r3" })).toBe(false);
  });

  it("requires current passing evidence and approval before merge", () => {
    expect(canMergeRevision(draft, current, passed, approved)).toBe(true);
    expect(canMergeRevision(draft, current, passed, { ...approved, revisionId: "CS-2481@r3" })).toBe(false);
    expect(canMergeRevision(draft, current, passed, { ...approved, decision: "Pending" })).toBe(false);
    expect(canMergeRevision(draft, current, { ...passed, status: "Failed" }, approved)).toBe(false);
  });

  it("blocks edits, revisions, evaluation and merge after merge", () => {
    expect(canEditChangeset("Merged")).toBe(false);
    expect(canCreateRevision(merged)).toBe(false);
    expect(canRunEvaluation(merged)).toBe(false);
    expect(canMergeRevision(merged, current, passed, approved)).toBe(false);
    expect(canCreateRevision(draft)).toBe(true);
    expect(canRunEvaluation(draft)).toBe(true);
  });
});
