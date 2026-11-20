import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { settingsNavGroups, settingsNavItems } from "./settings-nav";

export function SettingsSidebar() {
  const { t } = useTranslation("settings");

  return (
    <div className="settings-sidebar-inner">
      {/* Personal Settings (no group title) */}
      <nav className="settings-nav-section">
        {settingsNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `settings-nav-item ${isActive ? "active" : ""}`
              }
              end
            >
              <Icon size={16} />
              <span>{t(item.labelKey)}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Grouped Settings */}
      {settingsNavGroups.map((group) => (
        <div key={group.titleKey} className="settings-nav-group">
          <h3 className="settings-nav-group-title">{t(group.titleKey)}</h3>
          <nav className="settings-nav-section">
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `settings-nav-item ${isActive ? "active" : ""}`
                  }
                  end
                >
                  <Icon size={16} />
                  <span>{t(item.labelKey)}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>
      ))}
    </div>
  );
}
