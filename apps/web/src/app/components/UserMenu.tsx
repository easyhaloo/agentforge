import { BookMarked, Building2, Folders, LogOut, Settings, User } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { flatPaths, organizationHandle, orgPath } from "../../shared/routing";
import { Button, Popover } from "../../shared/ui";
import { AccountAvatar } from "../../shared/ui/components/AccountAvatar";
import { useAppAccount } from "../account-context";
import "./UserMenu.css";

type Props = { onSignOut: () => void };

export function UserMenu({ onSignOut }: Props) {
  const { t } = useTranslation("navigation");
  const { account, selectedOrganization } = useAppAccount();
  const location = useLocation();
  const handle = selectedOrganization && organizationHandle(selectedOrganization);
  const displayName = account?.display_name || account?.email || t("userMenu.notSignedIn");
  const menuLabel = t("userMenu.userMenuLabel");
  const avatar = <AccountAvatar userId={account?.user_id ?? ""} size={32} />;

  return (
    <div className="user-menu">
      <Popover
        key={`${location.key}:${account?.user_id ?? ""}`}
        ariaLabel={menuLabel}
        trigger={
          <span className="user-menu-trigger" title={displayName}>
            <span aria-hidden="true">{avatar}</span>
            <span className="user-menu-trigger__label">{menuLabel}, {displayName}</span>
          </span>
        }
      >
        <div className="user-menu-header">
          {avatar}
          <div className="user-menu-header__identity">
            <div className="user-menu-header__name" title={displayName}>{displayName}</div>
            {account?.email && <div className="user-menu-header__email" title={account.email}>{account.email}</div>}
          </div>
        </div>
        <hr />
        <Link className="user-menu-item" to={flatPaths.overview}>
          <User aria-hidden="true" />{t("userMenu.profile")}
        </Link>
        {handle && <Link className="user-menu-item" to={orgPath(handle, "repositories")}>
          <BookMarked aria-hidden="true" />{t("routes.repositories")}
        </Link>}
        <Link className="user-menu-item" to={flatPaths.projects}>
          <Folders aria-hidden="true" />{t("routes.projects")}
        </Link>
        <hr />
        <Link className="user-menu-item" to={flatPaths.settings}>
          <Settings aria-hidden="true" />{t("userMenu.settings")}
        </Link>
        {handle && <Link className="user-menu-item" to={orgPath(handle, "settings")}>
          <Building2 aria-hidden="true" />{t("userMenu.organization")}
        </Link>}
        {account && <>
          <hr />
          <Button variant="ghost" className="user-menu-item" onClick={onSignOut}>
            <LogOut aria-hidden="true" />{t("userMenu.signOut")}
          </Button>
        </>}
      </Popover>
    </div>
  );
}
