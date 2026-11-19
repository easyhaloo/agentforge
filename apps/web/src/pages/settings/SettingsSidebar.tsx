import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { settingsNavGroups, settingsNavItems } from "./settings-nav";

interface SettingsSidebarProps {
  username: string;
  displayName: string;
  avatarUrl?: string;
}

export function SettingsSidebar({ username, displayName, avatarUrl }: SettingsSidebarProps) {
  const { t } = useTranslation("settings");

  return (
    <div className="settings-sidebar-inner">
      {/* User Info Section */}
      <div className="settings-user-info">
        <div className="settings-user-avatar">
          {avatarUrl ? (
            <img src={avatarUrl} alt={displayName} />
          ) : (
            <div className="settings-user-avatar-placeholder">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div className="settings-user-details">
          <strong className="settings-user-name">{displayName}</strong>
          <span className="settings-user-handle">({username})</span>
          <span className="settings-user-type">{t("nav.userAccountType")}</span>
        </div>
      </div>

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
