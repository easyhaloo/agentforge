import { useMemo, useState, type FormEvent } from "react";
import { usePersistentState } from "../../shared/hooks/usePersistentState";
import { configs, type Item } from "./data/resourceConfigs";
import { ResourceListPanel } from "./ui/ResourceListPanel";
import { ResourceInspector } from "./ui/ResourceInspector";

type Props = { page: string; onNotify: (message: string) => void };

export function ResourceWorkspace({ page, onNotify }: Props) {
  const config = configs[page] ?? configs.Changesets;
  const [selected, setSelected] = useState(config.items[0]?.id ?? "");
  const [items, setItems] = usePersistentState<Item[]>("agentforge:resources:" + page, config.items);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("All");
  const [activity, setActivity] = useState<string[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");

  const filtered = useMemo(() => items.filter((item) =>
    (tab === "All" || item.status === tab) &&
    [item.id, item.name, item.detail, item.owner].join(" ").toLowerCase().includes(query.toLowerCase())
  ), [items, query, tab]);
  const current = items.find((item) => item.id === selected);

  const record = (message: string) => {
    setActivity((previous) => [message, ...previous].slice(0, 4));
    onNotify(message);
  };
  const doAction = () => record(config.action + " · demo action recorded locally");

  const createItem = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const id = page.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) + "-" + String(Date.now()).slice(-5);
    const item: Item = {
      id, name: newName.trim(), detail: "Created in " + page + " · local demo record",
      status: "Draft", updated: "Just now", owner: "You",
    };
    setItems((previous) => [item, ...previous]);
    setSelected(id);
    setNewName("");
    setShowCreate(false);
    record(id + " created locally");
  };

  return <div className="resource-workspace">
    <div className="resource-stats">
      {config.stats.map(([label, value, caption]) => <div className="card resource-stat" key={label}>
        <span>{label}</span><strong>{value}</strong><small>{caption}</small>
      </div>)}
    </div>
    <div className="resource-layout">
      <ResourceListPanel
        page={page} config={config} items={items} filtered={filtered} selected={selected}
        query={query} tab={tab} showCreate={showCreate} newName={newName}
        onQueryChange={setQuery} onTabChange={setTab} onSelect={setSelected}
        onShowCreate={() => setShowCreate(true)} onHideCreate={() => setShowCreate(false)}
        onNewNameChange={setNewName} onCreate={createItem} onAction={doAction}
      />
      <ResourceInspector page={page} config={config} current={current} activity={activity}
        onClose={() => setSelected("")} onAction={doAction}
      />
    </div>
  </div>;
}
