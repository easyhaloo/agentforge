import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { itemHref, navigationGroups } from "../navigation";
import { groupToNavKey, labelToNavKey } from "../navigation-labels";
import { Drawer } from "../../shared/ui";

// Links reuse the shared ghost Button classes, so navigation looks exactly like the buttons it replaced.
// Every item uses `end`: NavLink otherwise matches by prefix and would highlight an item for unknown paths below it
// (/projects/extra). An item must drop `end` once its section has nested routes (e.g. a changeset detail page).
const linkButton="af-button af-button--ghost af-button--middle";

type Props = { open: boolean; linkHandle: string; onClose: () => void };

export function Sidebar({ open, linkHandle, onClose }: Props) {
 const { t } = useTranslation("navigation");

 return <Drawer open={open} title={t("sidebar.navigation")} placement="left" width="min(296px, 90vw)" onClose={onClose}>
  <nav className="workspace-navigation" aria-label={t("sidebar.navigation")}>
    {navigationGroups.map(group=>(
      <section className="nav-group" key={group.label}>
        <div className="nav-label">{t(groupToNavKey(group.label))}</div>
        {group.items.map(item=>{
          const href=itemHref(item,linkHandle);
          return (
            <NavLink
              key={item.label}
              to={href}
              onClick={onClose}
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
  </nav>
 </Drawer>;
}
