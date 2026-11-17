export type EvidenceStatus = "Passed" | "Failed";
export type RevisionEvidence = { id: string; revisionId: string; status: EvidenceStatus };
