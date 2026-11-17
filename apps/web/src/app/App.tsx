import { useEffect, useState } from "react";
import { DeliveryFlow } from "../features/delivery";
import { createChangeset as createChangesetRequest } from "../features/delivery/api";
import { ApiError } from "../shared/api";
import { ResourceWorkspacePage } from "../pages/resources";
import { OverviewPage, type CreatedChangeset } from "../pages/overview";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { PageHeader } from "./components/PageHeader";
import { Toast } from "./components/Toast";
import { CreateChangesetDialog } from "./components/CreateChangesetDialog";
import { CommandPalette } from "./components/CommandPalette";

function App() {
  const [active, setActive] = useState("Overview");
  const [notice, setNotice] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [created, setCreated] = useState<CreatedChangeset[]>([]);

  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setShowCreate(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const createChangeset = async (input: { title: string; repository: string }): Promise<boolean> => {
    try {
      const result = await createChangesetRequest(input);
      setCreated((current) => [{ id: result.changeset.id, title: result.changeset.title }, ...current]);
      notify("Changeset " + result.changeset.id + " was persisted.");
      setActive("Changesets");
      return true;
    } catch (error) {
      const message = error instanceof ApiError
        ? error.message
        : error instanceof Error ? error.message : "Changeset creation failed.";
      notify("Changeset was not created: " + message);
      return false;
    }
  };

  return (
    <div className="shell">
      <Sidebar active={active} onNavigate={setActive} />
      <main className="main">
        <Topbar active={active} onSearch={() => setCommandOpen(true)} onNotify={notify} />
        <div className="content">
          <PageHeader
            active={active}
            onRefresh={() => notify(active === "Overview" ? "Overview metrics are not connected to the API yet." : "Refresh the delivery workspace below.")}
            onCreate={active === "Overview" || active === "Changesets" ? () => setShowCreate(true) : undefined}
          />
          {active === "Overview" ? (
            <OverviewPage onNavigate={setActive} onNotify={notify} created={created} />
          ) : ["Changesets", "Eval", "Review", "Trails", "Stacks", "Self-healing"].includes(active) ? (
            <DeliveryFlow page={active} onNotify={notify} />
          ) : (
            <ResourceWorkspacePage key={active} page={active} onNotify={notify} />
          )}
          <footer>
            <span>AgentForge <b>v0.1.0</b></span>
            <span><i className="live-dot" /> Core Changeset metadata uses the API <span className="footer-sep">·</span> Other workspaces are not yet integrated</span>
          </footer>
        </div>
      </main>
      <CreateChangesetDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={createChangeset}
      />
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} onNavigate={setActive} />
      <Toast message={notice} />
    </div>
  );
}

export default App;
