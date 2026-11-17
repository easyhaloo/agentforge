import type { EvidenceId, RevisionId } from "../identity";

export type EvidenceStatus = "Passed" | "Failed";

export type RevisionEvidence = {
  id: EvidenceId;
  revisionId: RevisionId;
  status: EvidenceStatus;
  checks: number;
  createdAt: string;
};
