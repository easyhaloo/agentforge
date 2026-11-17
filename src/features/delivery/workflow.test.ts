import { describe, expect, it } from "vitest";
import { initialChange, initialEvaluations, initialRevisions, initialReviews } from "./model";
import { createEvaluation, createNextRevision, createReviewDecision } from "./workflow";

describe("delivery feature workflows", () => {
  it("creates a revision entity while preserving changeset identity and history", () => {
    const result = createNextRevision(initialChange, initialRevisions, initialReviews);

    expect(result).not.toBeNull();
    expect(result?.change.id).toBe(initialChange.id);
    expect(result?.change.revision).toBe(initialChange.revision + 1);
    expect(result?.revision.id).toBe("CS-2481@r4");
    expect(result?.revision.changesetId).toBe(initialChange.id);
    expect(result?.revisions).toHaveLength(2);
    expect(result?.reviews[0].revisionId).toBe(result?.revision.id);
    expect(result?.reviews).toContain(initialReviews[0]);
  });

  it("refuses to create a revision for a merged changeset", () => {
    const merged = { ...initialChange, status: "Merged" as const };
    expect(createNextRevision(merged, initialRevisions, initialReviews)).toBeNull();
  });

  it("binds evaluation evidence to the active revision entity", () => {
    const revision = initialRevisions[0];
    const evaluation = createEvaluation(initialChange, revision, initialEvaluations, "Passed");

    expect(evaluation?.revisionId).toBe(revision.id);
    expect(evaluation?.status).toBe("Passed");
  });

  it("does not evaluate a revision that does not belong to the active changeset revision", () => {
    const wrongRevision = { ...initialRevisions[0], number: 2, id: "CS-2481@r2" };
    expect(createEvaluation(initialChange, wrongRevision, initialEvaluations, "Passed")).toBeNull();
  });

  it("requires current passing evidence before creating a review decision", () => {
    const revision = initialRevisions[0];
    const approved = createReviewDecision(initialChange, revision, initialReviews, initialEvaluations[0], "Approved");
    const blocked = createReviewDecision(initialChange, revision, initialReviews, {
      ...initialEvaluations[0], status: "Failed",
    }, "Approved");

    expect(approved?.revisionId).toBe(revision.id);
    expect(blocked).toBeNull();
  });
});
