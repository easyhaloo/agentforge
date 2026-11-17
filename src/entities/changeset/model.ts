export type ChangesetStatus =
  | "Draft"
  | "Evaluating"
  | "Ready for review"
  | "Changes requested"
  | "Approved"
  | "Merged";

export type Changeset = {
  id: string;
  repositoryId: string;
  title: string;
  status: ChangesetStatus;
};
