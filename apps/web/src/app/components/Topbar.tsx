import type { ReactNode } from "react";
import { Search, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { flatPaths } from "../../shared/routing";
import { useTranslation } from "react-i18next";
import { Button } from "../../shared/ui";
import { LanguageSwitcher } from "../../shared/ui/components/LanguageSwitcher";
import { labelToNavKey } from "../navigation-labels";
import { UserMenu } from "./UserMenu";

type Props = { focused?: boolean; label: string; onSearch: () => void; navigation?: ReactNode; organization?: ReactNode; onSignOut: () => void };

export function Topbar({ focused, label, onSearch, onSignOut, navigation, organization }: Props) {
  const { t } = useTranslation();
  const translatedLabel = t(labelToNavKey(label));

  return (
    <header className="topbar">
      {focused ? (
        <div className="settings-topbar-title">
          <Link to={flatPaths.overview} aria-label={t("navigation:sidebar.brand")}><Sparkles size={22} /></Link>
          <strong>{translatedLabel}</strong>
        </div>
      ) : <div className="workspace-brand">
        {navigation}
        <Link to={flatPaths.overview} aria-label={t("navigation:sidebar.brand")}>
          <span className="brand-mark"><Sparkles size={16} /></span><strong>{t("navigation:sidebar.productName")}</strong>
        </Link>
        <span className="workspace-brand__page">{translatedLabel}</span>
      </div>}
      <div className="top-actions">
        <Button variant="ghost" className="searchbox" onClick={onSearch} aria-label={t("navigation:topbar.searchAriaLabel")}>
          <Search size={15} /> {t("navigation:topbar.searchPlaceholder")} <kbd>⌘ K</kbd>
        </Button>
        {organization}
        <LanguageSwitcher />
        <UserMenu onSignOut={onSignOut} />
      </div>
    </header>
  );
}
