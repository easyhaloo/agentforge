import { Bell, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../shared/ui";
import { LanguageSwitcher } from "../../shared/ui/components/LanguageSwitcher";
import { UserMenu } from "./UserMenu";

type Props = { label: string; onSearch: () => void; onNotify: (message: string) => void; onSignOut: () => void };

/** Maps route label identifiers to translation keys. Route labels are stable English identifiers; this maps them to i18n keys. */
const labelToTranslationKey = (label: string): string => {
  const keyMap: Record<string, string> = {
    "Overview": "navigation:routes.overview",
    "Projects": "navigation:routes.projects",
    "Workspaces": "navigation:routes.workspaces",
    "Stacks": "navigation:routes.stacks",
    "Self-healing": "navigation:routes.selfHealing",
    "Memory": "navigation:routes.memory",
    "CI / CD": "navigation:routes.cicd",
    "Security": "navigation:routes.security",
    "Governance": "navigation:routes.governance",
    "Cost & Usage": "navigation:routes.usage",
    "Settings": "navigation:routes.settings",
    "Changesets": "navigation:routes.changesets",
    "Changeset": "navigation:routes.changeset",
    "Repositories": "navigation:routes.repositories",
    "Trails": "navigation:routes.trails",
    "Review": "navigation:routes.review",
    "Eval": "navigation:routes.eval",
    "Organization": "navigation:routes.organization",
    "UI Components": "navigation:routes.uiComponents",
    "Page not found": "navigation:routes.notFound",
  };
  return keyMap[label] || label;
};

export function Topbar({ label, onSearch, onNotify, onSignOut }: Props) {
  const { t } = useTranslation();
  const translatedLabel = t(labelToTranslationKey(label));

  return (
    <header className="topbar">
      <div className="breadcrumbs">{t("navigation:topbar.workspace")} <span>/</span> <b>{translatedLabel}</b></div>
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
