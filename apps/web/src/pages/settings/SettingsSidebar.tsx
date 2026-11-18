import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { User, Settings, Palette, Bell, Lock, Key, Monitor, Bot } from "lucide-react";

interface SettingsSidebarProps {
  username: string;
  displayName: string;
  avatarUrl?: string;
}

interface NavItem {
  to: string;
  labelKey: string;
  icon: React.ComponentType<{ size?: number }>;
}

interface NavGroup {
  titleKey: string;
  items: NavItem[];
}

export function SettingsSidebar({ username, displayName, avatarUrl }: SettingsSidebarProps) {
  const { t } = useTranslation("settings");

  // Personal settings (no group title)
  const personalItems: NavItem[] = [
    { to: "/settings/profile", labelKey: "nav.profile", icon: User },
    { to: "/settings/account", labelKey: "nav.account", icon: Settings },
    { to: "/settings/appearance", labelKey: "nav.appearance", icon: Palette },
    { to: "/settings/notifications", labelKey: "nav.notifications", icon: Bell },
  ];

  // Grouped settings
  const groups: NavGroup[] = [
    {
      titleKey: "nav.groupAccess",
      items: [
        { to: "/settings/authentication", labelKey: "nav.authentication", icon: Lock },
        { to: "/settings/keys", labelKey: "nav.keys", icon: Key },
        { to: "/settings/sessions", labelKey: "nav.sessions", icon: Monitor },
      ],
    },
    {
      titleKey: "nav.groupCode",
      items: [
        { to: "/settings/agents", labelKey: "nav.agents", icon: Bot },
      ],
    },
  ];

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
        {personalItems.map((item) => {
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
      {groups.map((group) => (
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
