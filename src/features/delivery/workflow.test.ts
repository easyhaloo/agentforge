import { describe, expect, it } from "vitest";
import { initialChange, initialEvaluations, initialReviews } from "./model";
import { createEvaluation, createNextRevision, createReviewDecision } from "./workflow";

describe("delivery feature workflows", () => {
  it("creates a new revision without changing the changeset identity", () => {
    const result = createNextRevision(initialChange, initialReviews);

    expect(result.change.id).toBe(initialChange.id);
    expect(result.change.revision).toBe(initialChange.revision + 1);
    expect(result.change.status).toBe("Draft");
    expect(result.reviews[0].revisionId).toBe("CS-2481@r4");
    expect(result.reviews[0].decision).toBe("Pending");
    expect(result.reviews).toContain(initialReviews[0]);
  });

  it("binds evaluation evidence to the exact active revision", () => {
    const nextChange = { ...initialChange, revision: 4 };
    const evaluation = createEvaluation(nextChange, initialEvaluations, 0);

    expect(evaluation.revisionId).toBe("CS-2481@r4");
    expect(evaluation.status).toBe("Passed");
  });

  it("keeps the demo repair failure deterministic", () => {
    const evaluation = createEvaluation(initialChange, initialEvaluations, 1);

    expect(evaluation.status).toBe("Failed");
  });

  it("binds review decisions to the revision being reviewed", () => {
    const review = createReviewDecision(initialChange, initialReviews, "Approved");

    expect(review.revisionId).toBe("CS-2481@r3");
    expect(review.decision).toBe("Approved");
  });
});
