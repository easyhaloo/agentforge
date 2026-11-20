import { Sparkles } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { itemHref, navigationGroups } from "../navigation";
import { groupToNavKey, labelToNavKey } from "../navigation-labels";
import type { AccountContext, OrganizationSummary } from "../../shared/api/identity";
import { Select } from "../../shared/ui";

// Links reuse the shared ghost Button classes, so navigation looks exactly like the buttons it replaced.
// Every item uses `end`: NavLink otherwise matches by prefix and would highlight an item for unknown paths below it
// (/projects/extra). An item must drop `end` once its section has nested routes (e.g. a changeset detail page).
const linkButton="af-button af-button--ghost af-button--middle";

type Props = { account: AccountContext | null; selectedOrganization: OrganizationSummary | undefined; linkHandle: string; onSelectOrganization: (id: string) => void };

export function Sidebar({ account, selectedOrganization: selected, linkHandle, onSelectOrganization }: Props) {
 const { t } = useTranslation("navigation");

 return <aside className="sidebar">
  <div className="brand">
    <div className="brand-mark"><Sparkles size={16}/></div>
    <b>{t("sidebar.brand")}</b>
  </div>
  <div className="org-switch">
    <Select
      aria-label={t("sidebar.selectOrganization")}
      value={selected?.id??""}
      onChange={e=>onSelectOrganization(e.target.value)}
      disabled={!account?.organizations.length}
      options={(account?.organizations??[]).map(o=>({
        label: o.name,
        value: o.id
      }))}
    />
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
              aria-label={t(labelToNavKey(item.label))}
              title={t(labelToNavKey(item.label))}
              end
              className={({isActive})=>`${linkButton} nav-item${isActive?" active":""}`}
            >
              <item.icon size={16}/>
              <span>{t(labelToNavKey(item.label))}</span>
            </NavLink>
          );
        })}
      </section>
    ))}
  </div>
 </aside>;
}
