import type { ReactNode } from "react";
import { Search, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { flatPaths, orgPath } from "../../shared/routing";
import { useTranslation } from "react-i18next";
import { Button } from "../../shared/ui";
import { TopbarIcon } from "./TopbarIcon";
import { labelToNavKey } from "../navigation-labels";
import { UserMenu } from "./UserMenu";

type Props = { focused?: boolean; label: string; pageLabelId?: string; onSearch: () => void; navigation?: ReactNode; organizationHandle?: string; context?: ReactNode; onSignOut: () => void };

export function Topbar({ focused, label, pageLabelId, onSearch, onSignOut, navigation, organizationHandle, context }: Props) {
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
          <span className="brand-mark"><Sparkles size={16} aria-hidden="true" /></span>
        </Link>
        {context ?? <span id={pageLabelId} className="workspace-brand__page">{translatedLabel}</span>}
      </div>}
      <div className="top-actions">
        <Button variant="ghost" className="searchbox" onClick={onSearch} aria-label={t("navigation:commandPalette.title")}
          aria-haspopup="dialog" aria-keyshortcuts="/ Control+K Meta+K">
          <Search size={15} aria-hidden="true" /> {t("navigation:commandPalette.title")} <kbd aria-hidden="true">/</kbd>
        </Button>
        {organizationHandle && <div className="topbar-shortcuts">
          <Link className="workspace-icon" to={orgPath(organizationHandle, "issues")} aria-label={t("navigation:topbar.allIssues")} title={t("navigation:topbar.allIssues")}>
            <TopbarIcon name="issue-opened" />
          </Link>
          <Link className="workspace-icon" to={orgPath(organizationHandle, "changesets")} aria-label={t("navigation:topbar.allPullRequests")} title={t("navigation:topbar.allPullRequests")}>
            <TopbarIcon name="git-pull-request" />
          </Link>
          <Link className="workspace-icon" to={orgPath(organizationHandle, "repositories")} aria-label={t("navigation:topbar.allRepositories")} title={t("navigation:topbar.allRepositories")}>
            <TopbarIcon name="repo" />
          </Link>
        </div>}
        <UserMenu onSignOut={onSignOut} />
      </div>
    </header>
  );
}
