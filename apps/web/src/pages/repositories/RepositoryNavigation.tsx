import { AlertCircle, Code2, GitBranch, GitPullRequest, Settings, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import type { OrganizationSummary } from "../../shared/api/identity";
import { repositoryPath, repositorySections } from "../../shared/routing";
import { canManageRepository } from "./repositoryPermissions";

const sectionIcons = { issues: AlertCircle, pulls: GitPullRequest, branches: GitBranch, actions: Workflow, settings: Settings };

type Props = { organization: OrganizationSummary; handle: string; repository: string };

export function RepositoryNavigation({ organization, handle, repository }: Props) {
  const { t } = useTranslation("repositories");
  return <nav className="repo-section-nav" aria-label={t("repositories:browser.sections")}>
    <NavLink to={repositoryPath(handle, repository)} end><Code2 size={16} aria-hidden="true"/>{t("repositories:browser.code")}</NavLink>
    {repositorySections.filter(section => section !== "settings" || canManageRepository(organization)).map(section => {
      const Icon = sectionIcons[section];
      return <NavLink key={section} to={repositoryPath(handle, repository, section)} end={section !== "issues" && section !== "pulls"}>
        <Icon size={16} aria-hidden="true"/>{t(`repositories:sections.${section}`)}
      </NavLink>;
    })}
  </nav>;
}
