import { useEffect, useMemo, useState } from "react";
import { ResourceWorkspace } from "./ResourceWorkspace";
import { DeliveryFlow } from "./DeliveryFlow";
import { Activity, Archive, ArrowDownUp, ArrowRight, Bell, BookOpen, Boxes, BrainCircuit, CheckCircle2, ChevronDown, CircleDot, Clock3, Code2, Command, GitBranch, GitCommitHorizontal, GitPullRequest, LayoutDashboard, LockKeyhole, Plus, Search, Settings, ShieldCheck, Sparkles, Terminal, Workflow, X, Zap } from "lucide-react";

const groups = [
  { label: "WORKSPACE", items: [["Overview", LayoutDashboard], ["Projects", Boxes], ["Repositories", Code2], ["Changesets", GitCommitHorizontal], ["Workspaces", Terminal]] },
  { label: "COORDINATION", items: [["Trails", Workflow], ["Stacks", GitBranch], ["Review", GitPullRequest], ["Eval", CheckCircle2], ["Self-healing", Activity]] },
  { label: "INTELLIGENCE", items: [["Memory", BrainCircuit], ["CI / CD", Zap]] },
  { label: "CONTROL PLANE", items: [["Security", ShieldCheck], ["Governance", LockKeyhole], ["Cost & Usage", ArrowDownUp], ["Settings", Settings]] }
] as const;
const descriptions: Record<string,string> = {
  Overview:"A live map of changes, verification and delivery across your engineering system.",
  Projects:"Organize repositories, teams and delivery boundaries.",
  Repositories:"Git-compatible repositories backed by a canonical object graph.",
  Changesets:"Reviewable, revisioned units of change — distinct from Git commits.",
  Workspaces:"Isolated environments for agents and human contributors.",
  Trails:"Cross-repository delivery goals with traceable evidence.",
  Stacks:"Compose dependent changesets into a navigable change graph.",
  Review:"Human decisions grounded in revision-specific evidence.",
  Eval:"Evaluate changes against quality, policy and product expectations.",
  "Self-healing":"Bounded repair loops that produce new revisions and re-run validation.",
  Memory:"Reusable engineering knowledge linked to sessions, code and decisions.",
  "CI / CD":"Pipelines, checks and release orchestration.",
  Security:"Identity, secrets, supply-chain and runtime boundaries.",
  Governance:"Policies, approvals and organization-wide controls.",
  "Cost & Usage":"Understand agent, model and compute consumption.",
  Settings:"Configure your organization and developer experience."
};
const seedRows = [
  ["CS-2481","Refactor auth token lifecycle","web-platform","Ready for review","4m ago"],
  ["CS-2479","Add retry policy to webhook worker","event-service","Evaluating","18m ago"],
  ["CS-2476","Improve repository graph indexing","agentforge-core","Changes requested","1h ago"],
  ["CS-2472","Update billing usage aggregation","billing-api","Merged","3h ago"],
  ["CS-2468","Fix workspace cleanup race","runtime","Draft","Yesterday"]
];
const metrics = [["Active changesets","28","+12%"],["Verification pass rate","96.4%","+2.1%"],["Open trails","7","2 at risk"],["Agent hours saved","142h","This month"]];
function App() {
  const [active,setActive] = useState("Overview");
  const [query,setQuery] = useState("");
  const [filter,setFilter] = useState("All");
  const [showCreate,setShowCreate] = useState(false);
  const [notice,setNotice] = useState("");
  const [selected,setSelected] = useState("CS-2481");
  const [commandOpen,setCommandOpen] = useState(false);
  const [created,setCreated] = useState<string[]>([]);
  const nav = useMemo<string[]>(()=>groups.flatMap(g=>g.items.map(i=>String(i[0]))),[]);
  const rows = [...seedRows,...created.map((v,i)=>[v,"New prototype changeset","agentforge-demo","Draft","Just now"] as string[])].filter(r=>(filter==="All"||r[3]===filter)&&r.join(" ").toLowerCase().includes(query.toLowerCase()));
  const notify = (s:string) => { setNotice(s); window.setTimeout(()=>setNotice(""),2600); };
  useEffect(()=>{const onKeyDown=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();setCommandOpen(true);}if(event.key==="Escape"){setCommandOpen(false);setShowCreate(false);}};window.addEventListener("keydown",onKeyDown);return()=>window.removeEventListener("keydown",onKeyDown);},[]);
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Sparkles size={19}/></div><div><b>agentforge</b><small>VERIFIED CHANGE PLATFORM</small></div></div>
      <button className="org-switch"><span className="org-avatar">E</span><span><b>Easyhaloo</b><small>Personal workspace</small></span><ChevronDown size={15}/></button>
      <div className="nav-scroll">{groups.map(group=><section className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.items.map(([name,Icon])=><button key={name} className={active===name?"nav-item active":"nav-item"} onClick={()=>setActive(name)}><Icon size={16}/><span>{name}</span>{name==="Changesets"&&<em>8</em>}</button>)}</section>)}</div>
      <div className="sidebar-bottom"><div className="usage"><div className="usage-head"><span>Monthly usage</span><b>68%</b></div><div className="progress"><i/></div><small>68.2k / 100k credits</small></div><button className="profile"><div className="avatar">H</div><span><b>Workspace owner</b><small>Free prototype</small></span><Settings size={15}/></button></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumbs">Workspace <span>/</span> <b>{active}</b></div><div className="top-actions"><button className="searchbox" onClick={()=>setCommandOpen(true)}><Search size={15}/> Search anything... <kbd>⌘ K</kbd></button><button className="icon-button" onClick={()=>notify("You're all caught up.")}><Bell size={17}/><i/></button><div className="avatar small">H</div></div></header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow">AGENTFORGE / {active.toUpperCase()}</div><h1>{active}</h1><p>{descriptions[active]}</p></div><div className="heading-actions"><button className="button secondary" onClick={()=>notify("Demo data refreshed.")}><Activity size={15}/> Refresh</button>{active==="Overview"&&<button className="button primary" onClick={()=>setShowCreate(true)}><Plus size={16}/> Create changeset</button>}</div></div>
        {active==="Overview"? <><div className="metric-grid">{metrics.map(([label,value,delta])=><div className="metric card" key={label}><div className="metric-top">{label}<span><Activity size={15}/></span></div><strong>{value}</strong><small>{delta}</small></div>)}</div><div className="dashboard-grid"><section className="card panel"><div className="panel-head"><div><h3>Change velocity</h3><p>Changesets created and merged · Last 7 days</p></div><button className="select-like">Last 7 days <ChevronDown size={13}/></button></div><div className="chart"><div className="chart-y"><span>40</span><span>30</span><span>20</span><span>10</span><span>0</span></div><div className="chart-main"><div className="grid-lines"><i/><i/><i/><i/><i/></div><svg viewBox="0 0 600 190" preserveAspectRatio="none"><defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#8b7cff" stopOpacity=".32"/><stop offset="100%" stopColor="#8b7cff" stopOpacity="0"/></linearGradient></defs><path d="M0 145 C35 132 45 115 85 125 S140 95 170 105 S220 65 255 90 S305 105 340 70 S390 78 425 52 S475 70 510 36 S560 45 600 18 L600 190 L0 190Z" fill="url(#fill)"/><path d="M0 145 C35 132 45 115 85 125 S140 95 170 105 S220 65 255 90 S305 105 340 70 S390 78 425 52 S475 70 510 36 S560 45 600 18" fill="none" stroke="#9b8cff" strokeWidth="3" vectorEffect="non-scaling-stroke"/></svg><div className="chart-x"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div></div></div></section><section className="card panel activity-panel"><div className="panel-head"><div><h3>Activity stream</h3><p>Latest events across your workspace</p></div><button className="link-button" onClick={()=>setActive("Trails")}>View all <ArrowRight size={14}/></button></div>{[["Changeset verified","CS-2479 passed all 42 checks","12 min ago","green"],["Review requested","Mina requested review on CS-2481","28 min ago","purple"],["Trail at risk","API migration is waiting on 1 dependency","1 hr ago","orange"],["Workspace created","Agent workspace ws-092 is ready","2 hr ago","blue"]].map(a=><div className="activity-row" key={a[0]}><span className={"event-dot "+a[3]}/><div><b>{a[0]}</b><small>{a[1]}</small></div><time>{a[2]}</time></div>)}</section></div></>:null}
        {["Changesets","Eval","Review","Trails","Stacks","Self-healing"].includes(active) ? <DeliveryFlow page={active} onNotify={notify}/> : active !== "Overview" ? <ResourceWorkspace page={active} onNotify={notify}/> : <section className="card table-panel"><div className="panel-head table-title"><div><h3>{active==="Overview"?"Recent changesets":active+" registry"}</h3><p>{active==="Overview"?"Track the latest work moving through verification.":"Browse and inspect your "+"overview resources."}</p></div><button className="link-button" onClick={()=>setActive("Changesets")}>View all <ArrowRight size={14}/></button></div><div className="table-tools"><div className="inline-search"><Search size={14}/><input placeholder={"Search overview..."} value={query} onChange={e=>setQuery(e.target.value)}/></div><select value={filter} onChange={e=>setFilter(e.target.value)}><option>All</option><option>Ready for review</option><option>Evaluating</option><option>Changes requested</option><option>Merged</option><option>Draft</option></select><button className="button secondary compact" onClick={()=>notify("Filters cleared.")}>More filters <ChevronDown size={13}/></button></div><div className="table-wrap"><table><thead><tr><th>IDENTIFIER</th><th>NAME</th><th>PROJECT</th><th>STATUS</th><th>UPDATED</th><th/></tr></thead><tbody>{rows.map(r=><tr key={r[0]} onClick={()=>setSelected(r[0])} className={selected===r[0]?"selected-row":""}><td><span className="mono">{r[0]}</span></td><td><b>{r[1]}</b></td><td><span className="repo-tag"><Code2 size={12}/>{r[2]}</span></td><td><span className={"status "+(r[3]==="Merged"?"success":r[3]==="Evaluating"?"info":r[3]==="Draft"?"muted":r[3]==="Changes requested"?"danger":"warning")}><i/>{r[3]}</span></td><td className="muted-text">{r[4]}</td><td><button className="more" onClick={e=>{e.stopPropagation();notify("More actions are available in the full product.")}}>···</button></td></tr>)}</tbody></table>{rows.length===0&&<div className="empty">No matching records.</div>}</div></section>}
        {selected && active==="Overview" && <section className="detail-strip card"><div className="detail-icon"><GitPullRequest size={18}/></div><div><b>{selected} <span className="detail-title">Selected changeset</span></b><p>Revision r3 · Base main · 12 files changed · 42 checks</p></div><div className="detail-right"><span className="status success"><i/>Evidence current</span><button className="link-button" onClick={()=>notify("Changeset detail view is a prototype interaction.")}>Open details <ArrowRight size={14}/></button></div></section>}
        <footer><span>AgentForge Prototype <b>v0.1.0</b></span><span><i className="live-dot"/> All systems operational <span className="footer-sep">·</span> Mock environment</span></footer>
      </div>
    </main>
    {showCreate&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setShowCreate(false)}}><div className="modal"><div className="modal-head"><div><span className="eyebrow">NEW RESOURCE</span><h2>Create {active==="Overview"?"changeset":active.slice(0,-1)}</h2></div><button className="icon-button" onClick={()=>setShowCreate(false)}><X size={18}/></button></div><form onSubmit={e=>{e.preventDefault();const id="CS-"+(2482+created.length);setCreated([...created,id]);setSelected(id);setShowCreate(false);notify(id+" created in local demo state.")}}><label>Title<input required placeholder="Describe the change or goal"/></label><label>Project<select><option>agentforge-core</option><option>web-platform</option><option>event-service</option></select></label><label>Description<textarea placeholder="What should this change accomplish?"/></label><div className="modal-actions"><button type="button" className="button secondary" onClick={()=>setShowCreate(false)}>Cancel</button><button className="button primary" type="submit"><Plus size={15}/> Create resource</button></div></form><p className="mock-note"><Sparkles size={13}/> This creates a local demo record only. No Git or backend operation is performed.</p></div></div>}
    {commandOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setCommandOpen(false)}}><div className="command-modal"><div className="command-input"><Search size={17}/><input autoFocus placeholder="Jump to a page..." value={query} onChange={e=>setQuery(e.target.value)}/><kbd>ESC</kbd></div>{nav.filter(n=>n.toLowerCase().includes(query.toLowerCase())).map(n=><button key={n} onClick={()=>{setActive(n);setCommandOpen(false);setQuery("")}}><CircleDot size={15}/>{n}<ArrowRight size={14}/></button>)}</div></div>}
    {notice&&<div className="toast"><CheckCircle2 size={16}/>{notice}</div>}
  </div>;
}
export default App;
