import { DataTable } from "../../../shared/ui";
import type { StoredChangeset } from "../../../shared/api/identity";
import { changesetStatusClass, changesetStatusLabels } from "../changeset-status";

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

/** One row per changeset the server sent: the browser never filters the list itself. */
export function changesetRows(items: StoredChangeset[]): ChangesetRow[] {
  return items.map(({ changeset, status, updated_at, version }) => ({
    id: changeset.id,
    title: changeset.title,
    repository: changeset.repository,
    status: changesetStatusLabels[status],
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
  emptyText: string;
  onPageChange: (page: number, pageSize: number) => void;
  onOpen: (id: string) => void;
};

/** The changeset list: the rows the server sent for the current filters, with server-side paging. */
export function ChangesetTable({ items, total, page, pageSize, emptyText, onPageChange, onOpen }: Props) {
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
    data={rows} rowKey="id" showColumnVisibility={false} emptyText={emptyText}
    sortMode="server" filterMode="server"
    pagination={{ page, pageSize, total }}
    onPageChange={onPageChange}
    onRowClick={row => onOpen(row.id)}
  />;
}
