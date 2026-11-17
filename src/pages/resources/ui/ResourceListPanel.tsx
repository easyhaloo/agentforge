import type { FormEvent } from "react";
import { Sparkles } from "lucide-react";
import type { Item, PageConfig } from "../data/resourceConfigs";

type Props = {
  page: string; config: PageConfig; items: Item[]; filtered: Item[];
  selected: string; query: string; tab: string; showCreate: boolean; newName: string;
  onQueryChange: (value: string) => void; onTabChange: (value: string) => void;
  onSelect: (id: string) => void; onShowCreate: () => void; onHideCreate: () => void;
  onNewNameChange: (value: string) => void; onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onAction: () => void;
};

export function ResourceListPanel(props: Props) {
  const { page, config, items, filtered, selected, query, tab, showCreate, newName,
    onQueryChange, onTabChange, onSelect, onShowCreate, onHideCreate, onNewNameChange, onCreate, onAction } = props;
  return <section className="card resource-list">
    <div className="resource-head">
      <div><h3>{page} workspace</h3><p>{config.intro}</p></div>
      <button className="button primary compact" onClick={page === "Cost & Usage" ? onAction : onShowCreate}><Sparkles size={14} />{config.action}</button>
    </div>
    {showCreate && <form className="resource-create" onSubmit={onCreate}>
      <input autoFocus required value={newName} onChange={(event) => onNewNameChange(event.target.value)} placeholder={"Name this " + page.toLowerCase().replace(/s$/, "") + "..."} />
      <button className="button primary compact" type="submit">Create</button>
      <button className="button secondary compact" type="button" onClick={onHideCreate}>Cancel</button>
    </form>}
    <div className="resource-filters">
      <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={"Search " + page.toLowerCase() + "..."} />
      <div className="resource-tabs">
        {["All", ...Array.from(new Set(items.map((item) => item.status)))].slice(0, 4).map((status) =>
          <button className={tab === status ? "chosen" : ""} key={status} onClick={() => onTabChange(status)}>{status}</button>
        )}
      </div>
    </div>
    <div className="resource-table-wrap">
      <table>
        <thead><tr>{["ID", "RESOURCE", "OWNER", "STATUS"].map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>{filtered.map((item) => <tr key={item.id} className={selected === item.id ? "selected-row" : ""} onClick={() => onSelect(item.id)}>
          <td><span className="mono">{item.id}</span></td>
          <td><b>{item.name}</b><small className="cell-detail">{item.detail}</small></td>
          <td>{item.owner}</td>
          <td><span className="resource-status">{item.status}</span></td>
        </tr>)}</tbody>
      </table>
      {filtered.length === 0 && <div className="empty">No matching resources.</div>}
    </div>
    <div className="resource-foot"><span>Showing {filtered.length} of {items.length} demo resources</span><span>Prototype data <i className="live-dot" /></span></div>
  </section>;
}
