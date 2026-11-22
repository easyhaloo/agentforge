import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DataTable } from "../../../shared/ui";
import type { ChangesetStatus, StoredChangeset } from "../../../shared/api/identity";
import { formatDateTime, useDateFormatting } from "../../../shared/i18n/format";
import { changesetStatusClass, changesetStatusLabel } from "../changeset-status";

export type ChangesetRow = {
  id: string;
  title: string;
  repository: string;
  status: ChangesetStatus;
  revision: string;
  updated: string;
  version: string;
};

/** One row per changeset the server sent: the browser never filters the list itself. */
export function changesetRows(items: StoredChangeset[], formatUpdated = formatDateTime): ChangesetRow[] {
  return items.map(({ changeset, status, updated_at, version }) => ({
    id: changeset.id,
    title: changeset.title,
    repository: changeset.repository,
    status,
    revision: changeset.revisions.slice(-1)[0]?.commit_sha?.slice(0, 12) || "—",
    updated: formatUpdated(updated_at),
    version: `v${version}`,
  }));
}

type Props = {
  items: StoredChangeset[];
  total: number;
  page: number;
  pageSize: number;
  emptyText: string;
  pathFor: (id: string) => string;
  onPageChange: (page: number, pageSize: number) => void;
  onOpen: (id: string) => void;
};

/** The changeset list: the rows the server sent for the current filters, with server-side paging. */
export function ChangesetTable({ items, total, page, pageSize, emptyText, pathFor, onPageChange, onOpen }: Props) {
  const { t } = useTranslation();
  const { formatDateTime: formatUpdated } = useDateFormatting();
  const rows = changesetRows(items, formatUpdated);
  return <DataTable<ChangesetRow>
    className="changesets-table"
    columns={[
      { key: "title", title: t("changesets:columns.changeset"), render: (_value, row) => <div><b><Link to={pathFor(row.id)}>{row.title}</Link></b><small className="mono">{row.id}</small></div> },
      { key: "repository", title: t("changesets:columns.repository") },
      { key: "status", title: t("changesets:columns.status"), render: (_value, row) => <span className={changesetStatusClass(row.status)}>{changesetStatusLabel(row.status, t)}</span> },
      { key: "revision", title: t("changesets:columns.revision") },
      { key: "updated", title: t("changesets:columns.updated") },
      { key: "version", title: t("changesets:columns.version") },
    ]}
    data={rows} rowKey="id" showColumnVisibility={false} emptyText={emptyText}
    sortMode="server" filterMode="server"
    pagination={{ page, pageSize, total }}
    onPageChange={onPageChange}
    onRowClick={row => onOpen(row.id)}
  />;
}
