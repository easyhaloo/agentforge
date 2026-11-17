import { ChevronDown, Settings, Sparkles } from "lucide-react";
import { groups } from "../navigation";
import type { AccountContext } from "../../shared/api/identity";

type Props = {
  active: string;
  onNavigate: (page: string) => void;
  account: AccountContext | null;
  selectedOrganizationID: string;
  onSelectOrganization: (id: string) => void;
};

export function Sidebar({ active, onNavigate, account, selectedOrganizationID, onSelectOrganization }: Props) {
  const selected = account?.organizations.find((organization) => organization.id === selectedOrganizationID);
  const initials = (account?.display_name || "A").trim().slice(0, 1).toUpperCase();
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark"><Sparkles size={19}/></div><div><b>agentforge</b><small>VERIFIED CHANGE PLATFORM</small></div></div>
    <label className="org-switch"><span className="org-avatar">{(selected?.name || "A").slice(0,1).toUpperCase()}</span><span className="org-switch__select"><b>{selected?.name || "No organization"}</b><small>{selected ? `${selected.role} workspace` : "Sign in to load organizations"}</small><select aria-label="Select organization" value={selectedOrganizationID} onChange={(event)=>onSelectOrganization(event.target.value)} disabled={!account?.organizations.length}>{account?.organizations.map(organization=><option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></span><ChevronDown size={15}/></label>
    <div className="nav-scroll">{groups.map(group=><section className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.items.map(([name,Icon])=><button key={name} className={active===name?"nav-item active":"nav-item"} onClick={()=>onNavigate(String(name))}><Icon size={16}/><span>{name}</span>{name==="Changesets"&&<em>8</em>}</button>)}</section>)}</div>
    <div className="sidebar-bottom"><div className="usage"><div className="usage-head"><span>Monthly usage</span><b>—</b></div><div className="progress"><i style={{width:"0%"}}/></div><small>Usage data not connected</small></div><button className="profile" onClick={()=>onNavigate("Settings")}><div className="avatar">{initials}</div><span><b>{account?.display_name || "Not signed in"}</b><small>{account?.email || "Account profile"}</small></span><Settings size={15}/></button></div>
  </aside>;
}
