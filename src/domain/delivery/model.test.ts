import { describe, expect, it } from "vitest";
import { changesetId, evidenceId, gitCommitSha, reviewId, revisionId } from "../../entities";
import {
  canApproveRevision,
  canCreateRevision,
  canEditChangeset,
  canMergeRevision,
  canRunEvaluation,
  isEvidenceCurrent,
  isReviewCurrent,
  isRevisionNumberAvailable,
  revisionKey,
} from "./index";

describe("revision-scoped delivery invariants", () => {
  const changeset = changesetId("CS-2481");
  const current = revisionKey(changeset, 4);
  const previous = revisionKey(changeset, 3);
  const passed = {
    id: evidenceId("EVL-1"), revisionId: current, status: "Passed" as const, checks: 38, createdAt: "now",
  };
  const approved = { id: reviewId("REV-1"), revisionId: current, decision: "Approved" as const, reviewer: "Mina" };
  const draft = { status: "Draft" as const, currentRevisionId: current };
  const merged = { status: "Merged" as const, currentRevisionId: current };
  const revisions = [
    { id: previous, changesetId: changeset, number: 3, baseCommitSha: null, headCommitSha: null, createdAt: "now" },
    { id: current, changesetId: changeset, number: 4, baseCommitSha: null, headCommitSha: null, createdAt: "now" },
  ];

  it("keeps entity identities distinct at the type boundary", () => {
    const changeId = changesetId("CS-2481");
    const revision = revisionId("CS-2481@r4");
    const commit = gitCommitSha("0123456789abcdef0123456789abcdef01234567");
    expect(changeId).not.toBe(revision);
    expect(revision).not.toBe(commit);
    expect(() => gitCommitSha("CS-2481")).toThrow(/full 40- or 64-character/);
    // @ts-expect-error A Revision ID is not a Changeset ID.
    const invalidChangesetId: ReturnType<typeof changesetId> = revision;
    expect(invalidChangesetId).toBe(revision);
  });

  it("marks evidence and review decisions from older revisions stale", () => {
    expect(isEvidenceCurrent(current, { ...passed, revisionId: previous })).toBe(false);
    expect(isReviewCurrent(current, { ...approved, revisionId: previous })).toBe(false);
  });

  it("requires passing evidence for the current revision before approval", () => {
    expect(canApproveRevision(current, passed)).toBe(true);
    expect(canApproveRevision(current, { ...passed, status: "Failed" })).toBe(false);
    expect(canApproveRevision(current, { ...passed, revisionId: previous })).toBe(false);
  });

  it("requires the active revision, passing evidence and approval before merge", () => {
    expect(canMergeRevision(draft, current, passed, approved)).toBe(true);
    expect(canMergeRevision(draft, previous, passed, approved)).toBe(false);
    expect(canMergeRevision(draft, current, passed, { ...approved, revisionId: previous })).toBe(false);
    expect(canMergeRevision(draft, current, passed, { ...approved, decision: "Pending" })).toBe(false);
    expect(canMergeRevision(draft, current, { ...passed, status: "Failed" }, approved)).toBe(false);
  });

  it("enforces revision number uniqueness within a changeset", () => {
    expect(isRevisionNumberAvailable(changeset, revisions, 5)).toBe(true);
    expect(isRevisionNumberAvailable(changeset, revisions, 4)).toBe(false);
    expect(isRevisionNumberAvailable(changeset, revisions, 0)).toBe(false);
    expect(isRevisionNumberAvailable(changesetId("CS-OTHER"), revisions, 4)).toBe(true);
    expect(() => revisionKey(changeset, 0)).toThrow();
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
