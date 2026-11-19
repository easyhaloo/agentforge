import { LogOut, Settings, User } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Popover } from "../../shared/ui";
import { flatPaths } from "../../shared/routing";
import { useAppAccount } from "../account-context";
import "./UserMenu.css";

type Props = {
  onSignOut: () => void;
};

export function UserMenu({ onSignOut }: Props) {
  const { t } = useTranslation("navigation");
  const { account } = useAppAccount();

  // Generate initials from display name
  const initials = (account?.display_name || "A").trim().slice(0, 1).toUpperCase();
  const displayName = account?.display_name || t("userMenu.notSignedIn");
  const email = account?.email || "";

  return (
    <Popover
      trigger={
        <div className="user-menu-trigger">
          <div className="avatar small">{initials}</div>
        </div>
      }
      placement="bottom"
      ariaLabel={t("userMenu.userMenuLabel") || "User menu"}
    >
      {/* User info header */}
      <div className="user-menu-header">
        <div className="user-menu-header__name">{displayName}</div>
        {email && <div className="user-menu-header__email">{email}</div>}
      </div>

      <div className="user-menu-divider" />

      {/* Menu items */}
      <Link to={flatPaths.overview} className="user-menu-item">
        <User size={14} />
        <span>{t("userMenu.profile")}</span>
      </Link>

      <Link to={flatPaths.settings} className="user-menu-item">
        <Settings size={14} />
        <span>{t("userMenu.settings")}</span>
      </Link>

      <div className="user-menu-divider" />

      {/* Sign out */}
      {account && (
        <button onClick={onSignOut} className="user-menu-item">
          <LogOut size={14} />
          <span>{t("userMenu.signOut")}</span>
        </button>
      )}
    </Popover>
  );
}
