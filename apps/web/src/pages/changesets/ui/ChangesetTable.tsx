import { DataTable } from "../../../shared/ui";
import type { StoredChangeset } from "../../../shared/api/identity";
import { changesetStatusClass } from "../changeset-status";

export type ChangesetRow = {
  id: string;
  title: string;
  repository: string;
  status: string;
  revision: string;
  updated: string;
  version: string;
};

const dateTime = (value: string) => new Date(value).toLocaleString();

// The status the browser derives from the stored changeset. The server owns it (ADR-003): this goes away with AC3.
function statusOf(item: StoredChangeset["changeset"]): string {
  if (item.merge) return "Merged";
  const revision = item.revisions[item.revisions.length - 1];
  if (!revision) return "Draft";
  const evaluation = item.evaluations.filter(value => value.revision_id === revision.id).slice(-1)[0];
  if (evaluation?.status === "failed") return "Evaluation failed";
  if (evaluation?.status !== "passed") return "Evaluation pending";
  if (!item.evidence.some(value => value.revision_id === revision.id && value.status === "active")) return "Evidence required";
  const review = item.reviews.filter(value => value.revision_id === revision.id).slice(-1)[0];
  if (!review) return "Review required";
  if (review.status === "rejected") return "Changes requested";
  if (review.status !== "approved") return "In review";
  return "Ready to merge";
}

/** One row per changeset the server sent: the browser never filters the list itself. */
export function changesetRows(items: StoredChangeset[]): ChangesetRow[] {
  return items.map(({ changeset, updated_at, version }) => ({
    id: changeset.id,
    title: changeset.title,
    repository: changeset.repository,
    status: statusOf(changeset),
    revision: changeset.revisions.slice(-1)[0]?.commit_sha?.slice(0, 12) || "—",
    updated: dateTime(updated_at),
    version: `v${version}`,
  }));
}

type Props = {
  items: StoredChangeset[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number, pageSize: number) => void;
  onOpen: (id: string) => void;
};

/** The changeset list: the rows the server sent for the current filters, with server-side paging. */
export function ChangesetTable({ items, total, page, pageSize, onPageChange, onOpen }: Props) {
  const rows = changesetRows(items);
  return <DataTable<ChangesetRow>
    columns={[
      { key: "title", title: "CHANGESET", render: (_value, row) => <div><b>{row.title}</b><small className="mono">{row.id}</small></div> },
      { key: "repository", title: "REPOSITORY" },
      { key: "status", title: "STATUS", render: value => <span className={changesetStatusClass(String(value))}>{String(value)}</span> },
      { key: "revision", title: "REVISION" },
      { key: "updated", title: "UPDATED" },
      { key: "version", title: "VERSION" },
    ]}
    data={rows} rowKey="id" showColumnVisibility={false} emptyText="No changesets yet."
    sortMode="server" filterMode="server"
    pagination={{ page, pageSize, total }}
    onPageChange={onPageChange}
    onRowClick={row => onOpen(row.id)}
  />;
}
