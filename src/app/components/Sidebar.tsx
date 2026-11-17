import { ChevronDown, Settings, Sparkles } from "lucide-react";
import { groups } from "../navigation";

type Props = { active: string; onNavigate: (page: string) => void };

export function Sidebar({ active, onNavigate }: Props) {
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark"><Sparkles size={19}/></div><div><b>agentforge</b><small>VERIFIED CHANGE PLATFORM</small></div></div>
    <button className="org-switch"><span className="org-avatar">E</span><span><b>Easyhaloo</b><small>Personal workspace</small></span><ChevronDown size={15}/></button>
    <div className="nav-scroll">{groups.map(group=><section className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.items.map(([name,Icon])=><button key={name} className={active===name?"nav-item active":"nav-item"} onClick={()=>onNavigate(String(name))}><Icon size={16}/><span>{name}</span>{name==="Changesets"&&<em>8</em>}</button>)}</section>)}</div>
    <div className="sidebar-bottom"><div className="usage"><div className="usage-head"><span>Monthly usage</span><b>68%</b></div><div className="progress"><i/></div><small>68.2k / 100k credits</small></div><button className="profile"><div className="avatar">H</div><span><b>Workspace owner</b><small>Free prototype</small></span><Settings size={15}/></button></div>
  </aside>;
}
