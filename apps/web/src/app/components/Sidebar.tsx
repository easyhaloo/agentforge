import { Sparkles } from "lucide-react";
import { useId } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { itemHref, navigationGroups } from "../navigation";
import { groupToNavKey, labelToNavKey } from "../navigation-labels";
import { Drawer } from "../../shared/ui";
import "./Sidebar.css";

type Props = { open: boolean; linkHandle: string; onClose: () => void };

export function Sidebar({ open, linkHandle, onClose }: Props) {
  const { t } = useTranslation("navigation");
  const groupId = useId();
  const title = t("sidebar.navigation");

  return (
    <Drawer open={open} title={title} hideTitle placement="left" width="min(320px, calc(100vw - 32px))" onClose={onClose}
      className="workspace-navigation-overlay"
      leadingIcon={<span className="brand-mark" aria-hidden="true"><Sparkles size={16} /></span>}>
      <nav className="workspace-navigation" aria-label={title}>
        {navigationGroups.map(group => {
          const headingId = `${groupId}-${group.label.replaceAll(" ", "-")}`;
          return (
            <section className="workspace-navigation__group" key={group.label} aria-labelledby={headingId}>
              <h3 id={headingId}>{t(groupToNavKey(group.label))}</h3>
              {group.items.map(item => (
                <NavLink key={item.label} to={itemHref(item, linkHandle)} onClick={onClose} end
                  className="af-button af-button--ghost af-action-row workspace-navigation__row">
                  <item.icon size={16} aria-hidden="true" />
                  {t(labelToNavKey(item.label))}
                </NavLink>
              ))}
            </section>
          );
        })}
      </nav>
    </Drawer>
  );
}
