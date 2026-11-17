import type { ChangesetId, RevisionId } from "../identity";

export type ChangesetStatus =
  | "Draft"
  | "Evaluating"
  | "Ready for review"
  | "Changes requested"
  | "Approved"
  | "Merged";

export type Changeset = {
  id: ChangesetId;
  repositoryId: string;
  title: string;
  status: ChangesetStatus;
  currentRevisionId: RevisionId;
};
