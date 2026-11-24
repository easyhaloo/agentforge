import { AlertCircle, Boxes, Code2, GitPullRequest, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import type { OrganizationSummary } from "../../shared/api/identity";
import { repositoryPath, repositorySections } from "../../shared/routing";
import { canManageRepository } from "./repositoryPermissions";

// GitHub Octicons triangle-circle-16 (MIT).
function ActionsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z" />
    </svg>
  );
}

const sectionIcons = { issues: AlertCircle, pulls: GitPullRequest, actions: ActionsIcon, projects: Boxes, settings: Settings };

type Props = { organization: OrganizationSummary; handle: string; repository: string; issuesDisabled: boolean };

export function RepositoryNavigation({ organization, handle, repository, issuesDisabled }: Props) {
  const { t } = useTranslation(["repositories", "navigation"]);
  return <nav className="repo-section-nav" aria-label={t("repositories:browser.sections")}>
    <NavLink to={repositoryPath(handle, repository)} end><Code2 size={16} aria-hidden="true"/>{t("repositories:browser.code")}</NavLink>
    {repositorySections.filter(section => (section !== "settings" || canManageRepository(organization)) && (section !== "issues" || !issuesDisabled)).map(section => {
      const Icon = sectionIcons[section];
      return <NavLink key={section} to={repositoryPath(handle, repository, section)} end={section === "actions"}>
        <Icon size={16} aria-hidden="true"/>{section === "projects" ? t("navigation:routes.projects") : t(`repositories:sections.${section}`)}
      </NavLink>;
    })}
  </nav>;
}
