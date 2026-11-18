import { ChevronDown, LogOut, Settings, Sparkles } from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import { Button, Select } from "../../shared/ui";
import { flatPaths } from "../../shared/routing";
import { itemHref, navigationGroups } from "../navigation";
import type { AccountContext, OrganizationSummary } from "../../shared/api/identity";
// Links reuse the shared ghost Button classes, so navigation looks exactly like the buttons it replaced.
// Every item uses `end`: NavLink otherwise matches by prefix and would highlight an item for unknown paths below it
// (/projects/extra). An item must drop `end` once its section has nested routes (e.g. a changeset detail page).
const linkButton="af-button af-button--ghost af-button--middle";
type Props = { account: AccountContext | null; selectedOrganization: OrganizationSummary | undefined; linkHandle: string; onSelectOrganization: (id: string) => void; onSignOut: () => void };
export function Sidebar({ account, selectedOrganization: selected, linkHandle, onSelectOrganization, onSignOut }: Props) {
 const initials=(account?.display_name||"A").trim().slice(0,1).toUpperCase();
 return <aside className="sidebar">
  <div className="brand"><div className="brand-mark"><Sparkles size={19}/></div><div><b>agentforge</b><small>VERIFIED CHANGE PLATFORM</small></div></div>
  <div className="org-switch"><span className="org-avatar">{(selected?.name||"A").slice(0,1).toUpperCase()}</span><span className="org-switch__select"><b>{selected?.name||"No organization"}</b><small>{selected?`${selected.role} workspace`:"Sign in to load organizations"}</small><Select aria-label="Select organization" value={selected?.id??""} onChange={e=>onSelectOrganization(e.target.value)} disabled={!account?.organizations.length} options={(account?.organizations??[]).map(o=>({label:o.name,value:o.id}))}/></span><ChevronDown size={15}/></div>
  <div className="nav-scroll">{navigationGroups.map(group=><section className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.items.map(item=>{const href=itemHref(item,linkHandle);return <NavLink key={item.label} to={href} end className={({isActive})=>`${linkButton} nav-item${isActive?" active":""}`}><item.icon size={16}/><span>{item.label}</span>{item.label==="Changesets"&&<em>8</em>}</NavLink>;})}</section>)}</div>
  <div className="sidebar-bottom"><div className="usage"><div className="usage-head"><span>Monthly usage</span><b>—</b></div><div className="progress"><i style={{width:"0%"}}/></div><small>Usage data not connected</small></div><div className="profile-row"><Link to={flatPaths.settings} className={`${linkButton} profile`}><div className="avatar">{initials}</div><span><b>{account?.display_name||"Not signed in"}</b><small>{account?.email||"Account profile"}</small></span><Settings size={15}/></Link>{account&&<Button variant="ghost" className="signout-button" onClick={onSignOut} title="Sign out" aria-label="Sign out"><LogOut size={15}/></Button>}</div></div>
 </aside>;
}