import { useEffect, useState } from "react";
import { DeliveryFlow } from "../features/delivery/DeliveryFlow";
import { ResourceWorkspace } from "../features/resources/ResourceWorkspace";
import { OverviewPage } from "../features/overview/OverviewPage";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { PageHeader } from "./components/PageHeader";
import { Toast } from "./components/Toast";
import { CreateChangesetDialog } from "./components/CreateChangesetDialog";
import { CommandPalette } from "./components/CommandPalette";

function App() {
  const [active,setActive] = useState("Overview");
  const [notice,setNotice] = useState("");
  const [showCreate,setShowCreate] = useState(false);
  const [commandOpen,setCommandOpen] = useState(false);
  const [created,setCreated] = useState<string[]>([]);
  const notify = (message: string) => { setNotice(message); window.setTimeout(()=>setNotice(""),2600); };
  useEffect(()=>{
    const onKeyDown=(event: KeyboardEvent)=>{
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();setCommandOpen(true);}
      if(event.key==="Escape"){setCommandOpen(false);setShowCreate(false);}
    };
    window.addEventListener("keydown",onKeyDown);
    return ()=>window.removeEventListener("keydown",onKeyDown);
  },[]);
  const createChangeset = (title: string) => { const id="CS-"+(2482+created.length); setCreated(current=>[...current,id]); notify(id+" created in local demo state: "+title); setShowCreate(false); };
  return <div className="shell">
    <Sidebar active={active} onNavigate={setActive}/>
    <main className="main">
      <Topbar active={active} onSearch={()=>setCommandOpen(true)} onNotify={notify}/>
      <div className="content">
        <PageHeader active={active} onRefresh={()=>notify("Demo data refreshed.")} onCreate={active==="Overview"?()=>setShowCreate(true):undefined}/>
        {active==="Overview" ? <OverviewPage onNavigate={setActive} onNotify={notify} created={created}/> :
          ["Changesets","Eval","Review","Trails","Stacks","Self-healing"].includes(active) ? <DeliveryFlow page={active} onNotify={notify}/> :
          <ResourceWorkspace page={active} onNotify={notify}/>}
        <footer><span>AgentForge Prototype <b>v0.1.0</b></span><span><i className="live-dot"/> All systems operational <span className="footer-sep">·</span> Mock environment</span></footer>
      </div>
    </main>
    <CreateChangesetDialog open={showCreate} onClose={()=>setShowCreate(false)} onCreate={createChangeset}/>
    <CommandPalette open={commandOpen} onClose={()=>setCommandOpen(false)} onNavigate={setActive}/>
    <Toast message={notice}/>
  </div>;
}
export default App;
