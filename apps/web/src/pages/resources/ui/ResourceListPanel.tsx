import type { FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { Button, DataTable, Input, Select } from "../../../shared/ui";
import type { PageConfig } from "../data/resourceConfigs";
import type { ResourceRow } from "../data/resourceRecords";

type Props = {
  page: string; config: PageConfig; items: ResourceRow[]; filtered: ResourceRow[];
  selected: string; query: string; tab: string; showCreate: boolean; newName: string;
  onQueryChange: (value: string) => void; onTabChange: (value: string) => void;
  onSelect: (id: string) => void; onShowCreate: () => void; onHideCreate: () => void;
  onNewNameChange: (value: string) => void; onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onAction: () => void;
};

export function ResourceListPanel(props: Props) {
  const { page, config, items, filtered, selected, query, tab, showCreate, newName,
    onQueryChange, onTabChange, onSelect, onShowCreate, onHideCreate, onNewNameChange, onCreate, onAction } = props;
  const statuses = ["All", ...Array.from(new Set(items.map((item) => item.status)))];
  const columns = config.columns.map((column) => ({
    key: column.field,
    title: column.label,
    render: (value: unknown) => column.format === "mono"
      ? <span className="mono">{String(value ?? "")}</span>
      : column.format === "status"
        ? <span className="resource-status">{String(value ?? "")}</span>
        : column.field === "name" ? <b>{String(value ?? "")}</b> : String(value ?? "—"),
  }));

  return <section className="card resource-list">
    <div className="resource-filters">
      <Input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={"Search " + page.toLowerCase() + "..."} aria-label={"Search " + page} />
      <Select
        aria-label="Filter by status"
        value={tab}
        onChange={(event) => onTabChange(event.target.value)}
        options={statuses.map((status) => ({ label: status === "All" ? "All statuses" : status, value: status }))}
      />
      {config.actionMode !== "none" && <Button variant="primary" size="small" onClick={config.actionMode === "create" ? onShowCreate : onAction}><Sparkles size={14} />{config.action}</Button>}
    </div>
    {showCreate && <form className="resource-create" onSubmit={onCreate}>
      <Input autoFocus required value={newName} onChange={(event) => onNewNameChange(event.target.value)} placeholder={"Name this " + page.toLowerCase().replace(/s$/, "") + "..."} aria-label={"New " + page + " name"} />
      <Button variant="primary" size="small" type="submit">Create</Button>
      <Button size="small" type="button" onClick={onHideCreate}>Cancel</Button>
    </form>}
    <div className="resource-table-wrap">
      <DataTable
        columns={columns}
        data={filtered}
        rowKey="id"
        onRowClick={(item) => onSelect(item.id)}
        rowClassName={(item) => selected === item.id ? "selected-row" : ""}
        showColumnVisibility={false}
        emptyText="No matching resources."
      />
    </div>
    <div className="resource-foot"><span>Showing {filtered.length} of {items.length} demo resources</span><span>Prototype data <i className="live-dot" /></span></div>
  </section>;
}
