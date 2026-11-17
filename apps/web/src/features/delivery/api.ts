import { apiClient } from "../../shared/api";

export type DeliveryStatus = "pending" | "passed" | "failed" | "active" | "stale" | "approved" | "rejected" | "completed";

export type DeliveryRevision = {
  id: string;
  ref: string;
  created_at: string;
};

export type DeliveryEvaluation = {
  id: string;
  revision_id: string;
  status: DeliveryStatus;
  summary: string;
  created_at: string;
};

export type DeliveryEvidence = {
  id: string;
  revision_id: string;
  evaluation_id: string;
  kind: string;
  uri: string;
  status: DeliveryStatus;
  created_at: string;
};

export type DeliveryReview = {
  id: string;
  revision_id: string;
  reviewer: string;
  status: DeliveryStatus;
  comment: string;
  created_at: string;
};

export type DeliveryAuditEvent = {
  sequence: number;
  actor: string;
  operation: string;
  target_id: string;
  outcome: string;
  at: string;
};

export type DeliveryChangeset = {
  id: string;
  created_by: string;
  repository: string;
  title: string;
  revisions: DeliveryRevision[];
  evaluations: DeliveryEvaluation[];
  evidence: DeliveryEvidence[];
  reviews: DeliveryReview[];
  merge?: {
    id: string;
    revision_id: string;
    actor: string;
    target_ref: string;
    commit_sha: string;
    created_at: string;
  };
  audit: DeliveryAuditEvent[];
};

export type StoredChangeset = {
  changeset: DeliveryChangeset;
  version: number;
  created_at: string;
  updated_at: string;
};

export type ChangesetPage = {
  items: StoredChangeset[];
  limit: number;
  offset: number;
};

export async function listChangesets(options: { limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  const query = params.size > 0 ? "?" + params.toString() : "";
  return apiClient.request<ChangesetPage>("/api/v1/changesets" + query);
}

export async function createChangeset(input: { repository: string; title: string }) {
  return apiClient.request<StoredChangeset>("/api/v1/changesets", {
    method: "POST",
    body: input,
  });
}
