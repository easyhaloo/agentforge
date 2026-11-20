import { describe, expect, it } from "vitest";
import i18n from "../../locales";
import {
  auditEntryLabel,
  auditOperationLabel,
  auditOutcomeLabel,
  changesetAuditOperations,
  changesetAuditOutcomes,
} from "./changeset-status";

/**
 * The audit trail shows the server's own codes. The codes stay the server's; the wording is the
 * interface's, so a reader never sees "review.decided" where "Review decided · Approved" belongs.
 */

const t = i18n.t.bind(i18n);

describe("audit labels", () => {
  it("translates every operation the server records", () => {
    for (const operation of changesetAuditOperations) {
      const label = auditOperationLabel(operation, t);
      expect(label, operation).not.toBe(operation);
      expect(label, operation).not.toContain(".");
    }
  });

  it("translates every outcome the server records", () => {
    for (const outcome of changesetAuditOutcomes) {
      expect(auditOutcomeLabel(outcome, t), outcome).not.toBe(outcome);
    }
  });

  it("keeps an operation the interface does not know readable as the server spelled it", () => {
    // A new server operation must not read as a missing translation.
    expect(auditOperationLabel("evidence.republished", t)).toBe("evidence.republished");
  });

  it("leaves the plain outcome out of the label", () => {
    expect(auditEntryLabel("changeset.created", "succeeded", t)).toBe("Changeset created");
  });

  it("adds the outcome when it says something the operation does not", () => {
    expect(auditEntryLabel("review.decided", "approved", t)).toBe("Review decided · Approved");
    expect(auditEntryLabel("review.decided", "rejected", t)).toBe("Review decided · Changes requested");
    expect(auditEntryLabel("review.superseded", "stale", t)).toBe("Review superseded · Superseded");
  });
});
