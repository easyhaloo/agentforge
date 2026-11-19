import { Bell, Search, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { flatPaths } from "../../shared/routing";
import { useTranslation } from "react-i18next";
import { Button } from "../../shared/ui";
import { LanguageSwitcher } from "../../shared/ui/components/LanguageSwitcher";
import { labelToNavKey } from "../navigation-labels";
import { UserMenu } from "./UserMenu";

type Props = { focused?: boolean; label: string; onSearch: () => void; onNotify: (message: string) => void; onSignOut: () => void };

export function Topbar({ focused, label, onSearch, onNotify, onSignOut }: Props) {
  const { t } = useTranslation();
  const translatedLabel = t(labelToNavKey(label));

  return (
    <header className="topbar">
      {focused ? (
        <div className="settings-topbar-title">
          <Link to={flatPaths.overview} aria-label={t("navigation:sidebar.brand")}><Sparkles size={22} /></Link>
          <strong>{translatedLabel}</strong>
        </div>
      ) : <div className="breadcrumbs">{t("navigation:topbar.workspace")} <span>/</span> <b>{translatedLabel}</b></div>}
      <div className="top-actions">
        <Button variant="ghost" className="searchbox" onClick={onSearch} aria-label={t("navigation:topbar.searchAriaLabel")}>
          <Search size={15} /> {t("navigation:topbar.searchPlaceholder")} <kbd>⌘ K</kbd>
        </Button>
        <Button variant="ghost" className="icon-button" onClick={() => onNotify(t("navigation:topbar.caughtUp"))} aria-label={t("navigation:topbar.notificationsAriaLabel")}>
          <Bell size={17} /><i />
        </Button>
        <LanguageSwitcher />
        <UserMenu onSignOut={onSignOut} />
      </div>
    </header>
  );
}
