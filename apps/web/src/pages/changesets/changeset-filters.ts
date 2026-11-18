import { changesetStatuses, type ChangesetStatus } from "../../shared/api/identity";

/** The list filters live in the URL, so a list is linkable, shareable and survives a reload. */
export type ChangesetFilters = {
  q: string;
  repository: string;
  status: ChangesetStatus | "";
  reviewer: string;
  limit: number;
  offset: number;
};

/** How many changesets the list asks the server for. */
export const CHANGESET_PAGE_SIZE = 20;

/** The server refuses a longer free-text filter. */
export const CHANGESET_QUERY_MAX = 200;

/** The filters the URL carries; anything unusable falls back to the default list. */
export function readChangesetFilters(params: URLSearchParams): ChangesetFilters {
  const limit = Number(params.get("limit"));
  const offset = Number(params.get("offset"));
  const status = params.get("status") ?? "";
  return {
    q: params.get("q") ?? "",
    repository: params.get("repository") ?? "",
    status: changesetStatuses.includes(status as ChangesetStatus) ? status as ChangesetStatus : "",
    reviewer: params.get("reviewer") ?? "",
    limit: Number.isFinite(limit) && limit > 0 ? limit : CHANGESET_PAGE_SIZE,
    offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
  };
}

/**
 * The next query string: the changed filters, the page size, and the first page of the new result.
 * A changed filter starts the list again, so the reader sees the rows the new filter matches.
 */
export function writeChangesetFilters(patch: Partial<ChangesetFilters>, current: URLSearchParams): URLSearchParams {
  const filters = { ...readChangesetFilters(current), ...patch };
  const next = new URLSearchParams();
  if (filters.q) next.set("q", filters.q);
  if (filters.repository) next.set("repository", filters.repository);
  if (filters.status) next.set("status", filters.status);
  if (filters.reviewer) next.set("reviewer", filters.reviewer);
  next.set("limit", String(filters.limit));
  next.set("offset", String(patch.offset ?? 0));
  return next;
}
