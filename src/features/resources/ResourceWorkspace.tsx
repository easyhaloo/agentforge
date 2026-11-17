import { useMemo, useState, type FormEvent } from "react";
import { usePersistentState } from "../../shared/hooks/usePersistentState";
import { Activity, ArrowRight, Check, CircleAlert, Clock3, GitBranch, GitCommitHorizontal, ShieldCheck, Sparkles, Workflow, X } from "lucide-react";

import { configs, type Item } from "./data/resourceConfigs";

export function ResourceWorkspace({page,onNotify}:{page:string;onNotify:(message:string)=>void}) {
  const config=configs[page] ?? configs.Changesets;
  const [selected,setSelected]=useState(config.items[0]?.id ?? "");
  const [items,setItems]=usePersistentState<Item[]>(`agentforge:resources:${page}`,config.items);
  const [query,setQuery]=useState("");
  const [tab,setTab]=useState("All");
  const [activity,setActivity]=useState<string[]>([]);
  const [showCreate,setShowCreate]=useState(false);
  const [newName,setNewName]=useState("");
  const filtered=useMemo(()=>items.filter(item=>(tab==="All"||item.status===tab)&&[item.id,item.name,item.detail,item.owner].join(" ").toLowerCase().includes(query.toLowerCase())),[items,query,tab]);
  const current=items.find(item=>item.id===selected);
  const record=(message:string)=>{setActivity(prev=>[message,...prev].slice(0,4));onNotify(message);};
  const doAction=()=>record(`${config.action} · demo action recorded locally`);
  const createItem=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const id=`${page.toUpperCase().replace(/[^A-Z]/g,"").slice(0,3)}-${String(Date.now()).slice(-5)}`;
    const item:Item={id,name:newName.trim(),detail:`Created in ${page} · local demo record`,status:"Draft",updated:"Just now",owner:"You"};
    setItems(prev=>[item,...prev]);setSelected(id);setNewName("");setShowCreate(false);record(`${id} created locally`);
  };
  return <div className="resource-workspace">
    <div className="resource-stats">{config.stats.map(([label,value,caption])=><div className="card resource-stat" key={label}><span>{label}</span><strong>{value}</strong><small>{caption}</small></div>)}</div>
    <div className="resource-layout">
      <section className="card resource-list">
        <div className="resource-head"><div><h3>{page} workspace</h3><p>{config.intro}</p></div><button className="button primary compact" onClick={()=>page==="Cost & Usage"?doAction():setShowCreate(true)}><Sparkles size={14}/>{config.action}</button></div>
        {showCreate&&<form className="resource-create" onSubmit={createItem}><input autoFocus required value={newName} onChange={e=>setNewName(e.target.value)} placeholder={`Name this ${page.toLowerCase().replace(/s$/,"")}...`}/><button className="button primary compact" type="submit">Create</button><button className="button secondary compact" type="button" onClick={()=>setShowCreate(false)}>Cancel</button></form>}
        <div className="resource-filters"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={`Search ${page.toLowerCase()}...`}/><div className="resource-tabs">{["All",...Array.from(new Set(items.map(i=>i.status)))].slice(0,4).map(t=><button className={tab===t?"chosen":""} key={t} onClick={()=>setTab(t)}>{t}</button>)}</div></div>
        <div className="resource-table-wrap"><table><thead><tr>{["ID","RESOURCE","OWNER","STATUS"].map(col=><th key={col}>{col}</th>)}</tr></thead><tbody>{filtered.map(item=><tr key={item.id} className={selected===item.id?"selected-row":""} onClick={()=>setSelected(item.id)}><td><span className="mono">{item.id}</span></td><td><b>{item.name}</b><small className="cell-detail">{item.detail}</small></td><td>{item.owner}</td><td><span className="resource-status">{item.status}</span></td></tr>)}</tbody></table>{filtered.length===0&&<div className="empty">No matching resources.</div>}</div>
        <div className="resource-foot"><span>Showing {filtered.length} of {items.length} demo resources</span><span>Prototype data <i className="live-dot"/></span></div>
      </section>
      <aside className="card resource-detail">
        <div className="resource-detail-top"><span className="eyebrow">INSPECTOR</span><button className="icon-button" onClick={()=>setSelected("")}><X size={15}/></button></div>
        {current?<><div className="resource-detail-icon"><GitCommitHorizontal size={20}/></div><h3>{current.name}</h3><div className="resource-id">{current.id}</div><span className="resource-status detail-status">{current.status}</span><div className="detail-meta"><div><span>Owner</span><b>{current.owner}</b></div><div><span>Last updated</span><b>{current.updated}</b></div></div><div className="detail-divider"/><h4>{config.detailTitle}</h4>{config.signals.map((signal,i)=><div className="signal-row" key={signal}><span>{i+1}</span>{signal}<ArrowRight size={13}/></div>)}<button className="button secondary detail-action" onClick={doAction}>Open {page.toLowerCase()} details <ArrowRight size={14}/></button></>:<div className="empty">Select a resource to inspect its details.</div>}
        {activity.length>0&&<div className="local-activity"><h4><Activity size={13}/> Local activity</h4>{activity.map((a,i)=><p key={i}><Check size={12}/>{a}</p>)}</div>}
        <div className="prototype-callout"><ShieldCheck size={14}/><span>Demo environment. Actions update local UI state only; no remote operation is performed.</span></div>
      </aside>
    </div>
  </div>;
}
