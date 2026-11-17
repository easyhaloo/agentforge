import { describe, expect, it } from "vitest";
import { initialChange, initialEvaluations, initialRevisions, initialReviews, migrateChangeState, selectEvaluationViews, selectReviewViews } from "./model";
import { isRevisionNumberAvailable, revisionKey } from "../../domain/delivery";
import { changesetId, revisionId } from "../../entities";
import {
  createEvaluation,
  createNextRevision,
  createReviewDecision,
  mergeChangeset,
  resolveCurrentRevision,
} from "./use-cases";

describe("delivery feature use cases", () => {
  it("creates a revision entity while preserving changeset identity and history", () => {
    const result = createNextRevision(initialChange, initialRevisions, initialReviews);

    expect(result).not.toBeNull();
    expect(result?.change.id).toBe(initialChange.id);
    expect(result?.change.currentRevisionId).toBe("CS-2481@r4");
    expect(result?.revision.id).toBe("CS-2481@r4");
    expect(result?.revision.changesetId).toBe(initialChange.id);
    expect(result?.revisions).toHaveLength(2);
    expect(result?.reviews[0].revisionId).toBe(result?.revision.id);
    expect(result?.reviews[0]).not.toHaveProperty("revision");
    expect(result?.reviews).toContain(initialReviews[0]);
    expect(result?.change).not.toHaveProperty("revision");
  });

  it("refuses to create a revision for a merged changeset", () => {
    const merged = { ...initialChange, status: "Merged" as const };
    expect(createNextRevision(merged, initialRevisions, initialReviews)).toBeNull();
  });

  it("restores the active revision entity from its explicit identity", () => {
    const legacyRevision = { ...initialRevisions[0], number: 4, id: revisionId("CS-2481@r4") };
    const change = { ...initialChange, currentRevisionId: legacyRevision.id };
    const revision = resolveCurrentRevision(change, [initialRevisions[0]]);

    expect(revision.id).toBe("CS-2481@r4");
    expect(revision.changesetId).toBe(change.id);
    expect(revision.number).toBe(4);
    expect(revision.baseCommitSha).toBeNull();
  });

  it("migrates legacy local state from a revision number to a revision identity", () => {
    const legacyChange = {
      id: initialChange.id,
      repositoryId: initialChange.repositoryId,
      title: initialChange.title,
      status: initialChange.status,
      revision: 4,
      base: initialChange.base,
      files: initialChange.files,
    };
    const result = migrateChangeState(legacyChange, initialRevisions);

    expect(result.migrated).toBe(true);
    expect(result.change.currentRevisionId).toBe("CS-2481@r4");
    expect(result.change).not.toHaveProperty("revision");
    expect(result.revisions.map((revision) => revision.number)).toEqual([3, 4]);
  });

  it("falls back safely when persisted changeset data is malformed", () => {
    const result = migrateChangeState({ id: null }, initialRevisions);

    expect(result.change).toEqual(initialChange);
    expect(result.migrated).toBe(true);
  });

  it("rejects duplicate or invalid revision numbers within a changeset", () => {
    expect(isRevisionNumberAvailable(initialChange.id, initialRevisions, 4)).toBe(true);
    expect(isRevisionNumberAvailable(initialChange.id, initialRevisions, 3)).toBe(false);
    expect(isRevisionNumberAvailable(initialChange.id, initialRevisions, 0)).toBe(false);
    expect(isRevisionNumberAvailable(changesetId("CS-OTHER"), initialRevisions, 3)).toBe(true);
    expect(() => revisionKey(initialChange.id, 0)).toThrow();
  });

  it("binds evaluation evidence to the active revision entity", () => {
    const revision = initialRevisions[0];
    const evaluation = createEvaluation(initialChange, revision, initialEvaluations, "Passed");

    expect(evaluation?.revisionId).toBe(revision.id);
    expect(evaluation?.status).toBe("Passed");
    expect(evaluation).not.toHaveProperty("revision");
  });

  it("does not evaluate a revision that does not belong to the active changeset revision", () => {
    const wrongRevision = { ...initialRevisions[0], number: 2, id: revisionId("CS-2481@r2") };
    expect(createEvaluation(initialChange, wrongRevision, initialEvaluations, "Passed")).toBeNull();
  });

  it("projects revision numbers into feature view models without storing them on entities", () => {
    const evaluations = selectEvaluationViews(initialEvaluations, initialRevisions);
    const reviews = selectReviewViews(initialReviews, initialRevisions);

    expect(evaluations[0].revisionNumber).toBe(3);
    expect(reviews[0].revisionNumber).toBe(3);
    expect(selectEvaluationViews(initialEvaluations, []).at(0)?.revisionNumber).toBeNull();
    expect(selectReviewViews(initialReviews, []).at(0)?.revisionNumber).toBeNull();
    expect(initialEvaluations[0]).not.toHaveProperty("revision");
    expect(initialReviews[0]).not.toHaveProperty("revision");
  });

  it("requires current passing evidence before creating a review decision", () => {
    const revision = initialRevisions[0];
    const approved = createReviewDecision(initialChange, revision, initialReviews, initialEvaluations[0], "Approved");
    const blocked = createReviewDecision(initialChange, revision, initialReviews, {
      ...initialEvaluations[0], status: "Failed",
    }, "Approved");

    expect(approved?.revisionId).toBe(revision.id);
    expect(approved).not.toHaveProperty("revision");
    expect(blocked).toBeNull();
  });

  it("merges only with current passing evidence and approval", () => {
    const revision = initialRevisions[0];
    const approved = createReviewDecision(initialChange, revision, initialReviews, initialEvaluations[0], "Approved");
    expect(mergeChangeset(initialChange, revision.id, initialEvaluations[0], approved)?.status).toBe("Merged");
    expect(mergeChangeset(initialChange, revision.id, initialEvaluations[0], initialReviews[0])).toBeNull();
    expect(mergeChangeset({ ...initialChange, status: "Merged" }, revision.id, initialEvaluations[0], approved)).toBeNull();
  });
});
