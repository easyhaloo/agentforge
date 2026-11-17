import { useMemo, useState, type FormEvent } from "react";
import { usePersistentState } from "../../shared/hooks/usePersistentState";
import { buildResourceCsv } from "./data/resourceExport";
import { configs, type Item } from "./data/resourceConfigs";
import { createResourceDraft, resolvePageAction } from "./data/resourceDemoService";
import { ResourceListPanel } from "./ui/ResourceListPanel";
import { ResourceInspector } from "./ui/ResourceInspector";

type Props = { page: string; onNotify: (message: string) => void };

function downloadCsv(content: string, filename: string) {
  const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ResourceWorkspacePage({ page, onNotify }: Props) {
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
    Object.values(item).join(" ").toLowerCase().includes(query.trim().toLowerCase())
  ), [items, query, tab]);
  const current = items.find((item) => item.id === selected);

  const record = (message: string) => {
    setActivity((previous) => [message, ...previous].slice(0, 4));
    onNotify(message);
  };

  const runPageAction = () => {
    const action = resolvePageAction(config, page, filtered.length);
    if (!action) return;

    if (action.type === "review-queue") {
      setQuery(action.query);
      setTab(action.status);
    } else if (action.type === "export") {
      downloadCsv(buildResourceCsv(filtered, config.columns), action.filename);
    }

    record(action.message);
  };

  const createItem = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const id = page.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) + "-" + String(Date.now()).slice(-5);
    const item = createResourceDraft(page, name, id);
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
        onNewNameChange={setNewName} onCreate={createItem} onAction={runPageAction}
      />
      <ResourceInspector current={current} config={config} activity={activity} onClose={() => setSelected("")} />
    </div>
  </div>;
}
