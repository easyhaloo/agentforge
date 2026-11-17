type Brand<Value, Name extends string> = Value & { readonly __brand: Name };

export type ChangesetId = Brand<string, "ChangesetId">;
export type RevisionId = Brand<string, "RevisionId">;
export type EvidenceId = Brand<string, "EvidenceId">;
export type ReviewId = Brand<string, "ReviewId">;
export type GitCommitSha = Brand<string, "GitCommitSha">;

function nonEmptyIdentifier(value: string, kind: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${kind} must not be empty`);
  }
  return value;
}

export const changesetId = (value: string): ChangesetId =>
  nonEmptyIdentifier(value, "Changeset ID") as ChangesetId;

export const revisionId = (value: string): RevisionId =>
  nonEmptyIdentifier(value, "Revision ID") as RevisionId;

export const evidenceId = (value: string): EvidenceId =>
  nonEmptyIdentifier(value, "Evidence ID") as EvidenceId;

export const reviewId = (value: string): ReviewId =>
  nonEmptyIdentifier(value, "Review ID") as ReviewId;

export function gitCommitSha(value: string): GitCommitSha {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value)) {
    throw new Error("Git commit SHA must be a full 40- or 64-character hexadecimal object ID");
  }
  return value as GitCommitSha;
}
