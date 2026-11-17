export type Revision = {
  id: string;
  changesetId: string;
  number: number;
  baseCommitSha: string | null;
  headCommitSha: string | null;
  createdAt: string;
};
