import type { ChangesetId, GitCommitSha, RevisionId } from "../identity";

export type Revision = {
  id: RevisionId;
  changesetId: ChangesetId;
  number: number;
  baseCommitSha: GitCommitSha | null;
  headCommitSha: GitCommitSha | null;
  createdAt: string;
};
