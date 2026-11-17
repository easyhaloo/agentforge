import { describe, expect, it } from "vitest";
import { canApproveRevision, canMergeRevision, isEvidenceCurrent, revisionKey } from "./index";

describe("revision-scoped delivery invariants", () => {
  const current = revisionKey("CS-2481", 4);
  const passed = { id: "EVL-1", revisionId: current, status: "Passed" as const };
  const approved = { id: "REV-1", revisionId: current, decision: "Approved" as const };

  it("keeps changeset identity separate from revision identity", () => {
    expect(revisionKey("CS-2481", 3)).not.toBe(revisionKey("CS-2481", 4));
  });
  it("marks evidence from an older revision stale", () => {
    expect(isEvidenceCurrent(current, { ...passed, revisionId: "CS-2481@r3" })).toBe(false);
  });
  it("requires passing evidence for the current revision before approval", () => {
    expect(canApproveRevision(current, passed)).toBe(true);
    expect(canApproveRevision(current, { ...passed, status: "Failed" })).toBe(false);
    expect(canApproveRevision(current, { ...passed, revisionId: "CS-2481@r3" })).toBe(false);
  });
  it("requires current passing evidence and approval before merge", () => {
    expect(canMergeRevision(current, passed, approved)).toBe(true);
    expect(canMergeRevision(current, passed, { ...approved, revisionId: "CS-2481@r3" })).toBe(false);
    expect(canMergeRevision(current, { ...passed, status: "Failed" }, approved)).toBe(false);
  });
});
