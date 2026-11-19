import { Sparkles } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { itemHref, navigationGroups } from "../navigation";
import type { AccountContext, OrganizationSummary } from "../../shared/api/identity";

// Links reuse the shared ghost Button classes, so navigation looks exactly like the buttons it replaced.
// Every item uses `end`: NavLink otherwise matches by prefix and would highlight an item for unknown paths below it
// (/projects/extra). An item must drop `end` once its section has nested routes (e.g. a changeset detail page).
const linkButton="af-button af-button--ghost af-button--middle";

/** Maps navigation labels to translation keys */
const labelToNavKey = (label: string): string => {
  const keyMap: Record<string, string> = {
    "Overview": "routes.overview",
    "Projects": "routes.projects",
    "Repositories": "routes.repositories",
    "Changesets": "routes.changesets",
    "Workspaces": "routes.workspaces",
    "Trails": "routes.trails",
    "Stacks": "routes.stacks",
    "Review": "routes.review",
    "Eval": "routes.eval",
    "Self-healing": "routes.selfHealing",
    "Memory": "routes.memory",
    "CI / CD": "routes.cicd",
    "UI Components": "routes.uiComponents",
    "Organization": "routes.organization",
    "Security": "routes.security",
    "Governance": "routes.governance",
    "Cost & Usage": "routes.usage",
    "Settings": "routes.settings",
  };
  return keyMap[label] || label;
};

/** Maps group labels to translation keys */
const groupToNavKey = (label: string): string => {
  return `groups.${label}`;
};

type Props = { account: AccountContext | null; selectedOrganization: OrganizationSummary | undefined; linkHandle: string; onSelectOrganization: (id: string) => void };

export function Sidebar({ account, selectedOrganization: selected, linkHandle, onSelectOrganization }: Props) {
 const { t } = useTranslation("navigation");

 return <aside className="sidebar">
  <div className="brand">
    <div className="brand-mark"><Sparkles size={16}/></div>
    <b>{t("sidebar.brand")}</b>
  </div>
  <div className="org-switch">
    <select
      aria-label={t("sidebar.selectOrganization")}
      value={selected?.id??""}
      onChange={e=>onSelectOrganization(e.target.value)}
      disabled={!account?.organizations.length}
    >
      {(account?.organizations??[]).map(o=>(
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  </div>
  <div className="nav-scroll">
    {navigationGroups.map(group=>(
      <section className="nav-group" key={group.label}>
        <div className="nav-label">{t(groupToNavKey(group.label))}</div>
        {group.items.map(item=>{
          const href=itemHref(item,linkHandle);
          return (
            <NavLink
              key={item.label}
              to={href}
              end
              className={({isActive})=>`${linkButton} nav-item${isActive?" active":""}`}
            >
              <item.icon size={16}/>
              <span>{t(labelToNavKey(item.label))}</span>
              {item.label==="Changesets"&&<em>8</em>}
            </NavLink>
          );
        })}
      </section>
    ))}
  </div>
  <div className="sidebar-bottom">
    <div className="usage">
      <div className="usage-head">
        <span>{t("sidebar.monthlyUsage")}</span>
        <b>—</b>
      </div>
      <div className="progress"><i style={{width:"0%"}}/></div>
      <small>{t("sidebar.usageNotConnected")}</small>
    </div>
  </div>
 </aside>;
}