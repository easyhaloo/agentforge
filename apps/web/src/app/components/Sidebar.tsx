import { ChevronDown, LogOut, Settings, Sparkles } from "lucide-react";
import { Button, Select } from "../../shared/ui";
import { navigationGroups } from "../navigation";
import type { AccountContext } from "../../shared/api/identity";
type Props = { active: string; onNavigate: (page: string) => void; account: AccountContext | null; selectedOrganizationID: string; onSelectOrganization: (id: string) => void; onSignOut: () => void };
export function Sidebar({ active, onNavigate, account, selectedOrganizationID, onSelectOrganization, onSignOut }: Props) {
 const selected=account?.organizations.find(o=>o.id===selectedOrganizationID);
 const initials=(account?.display_name||"A").trim().slice(0,1).toUpperCase();
 return <aside className="sidebar">
  <div className="brand"><div className="brand-mark"><Sparkles size={19}/></div><div><b>agentforge</b><small>VERIFIED CHANGE PLATFORM</small></div></div>
  <div className="org-switch"><span className="org-avatar">{(selected?.name||"A").slice(0,1).toUpperCase()}</span><span className="org-switch__select"><b>{selected?.name||"No organization"}</b><small>{selected?`${selected.role} workspace`:"Sign in to load organizations"}</small><Select aria-label="Select organization" value={selectedOrganizationID} onChange={e=>onSelectOrganization(e.target.value)} disabled={!account?.organizations.length} options={(account?.organizations??[]).map(o=>({label:o.name,value:o.id}))}/></span><ChevronDown size={15}/></div>
  <div className="nav-scroll">{navigationGroups.map(group=><section className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.items.map(({label:name,icon:Icon})=><Button key={name} variant="ghost" className={active===name?"nav-item active":"nav-item"} aria-current={active===name?"page":undefined} onClick={()=>onNavigate(name)}><Icon size={16}/><span>{name}</span>{name==="Changesets"&&<em>8</em>}</Button>)}</section>)}</div>
  <div className="sidebar-bottom"><div className="usage"><div className="usage-head"><span>Monthly usage</span><b>—</b></div><div className="progress"><i style={{width:"0%"}}/></div><small>Usage data not connected</small></div><div className="profile-row"><Button variant="ghost" className="profile" onClick={()=>onNavigate("Settings")}><div className="avatar">{initials}</div><span><b>{account?.display_name||"Not signed in"}</b><small>{account?.email||"Account profile"}</small></span><Settings size={15}/></Button>{account&&<Button variant="ghost" className="signout-button" onClick={onSignOut} title="Sign out" aria-label="Sign out"><LogOut size={15}/></Button>}</div></div>
 </aside>;
}