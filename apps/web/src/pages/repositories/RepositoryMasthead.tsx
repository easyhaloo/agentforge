import type { ReactNode } from "react";
import { AlertCircle, Code2, GitBranch, Settings, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, NavLink } from "react-router-dom";
import type { OrganizationSummary } from "../../shared/api/identity";
import { organizationHandle, orgPath, repositoryPath, repositorySections } from "../../shared/routing";
import "./repositories.css";

type Props = { organization: OrganizationSummary; repository: string; actions?: ReactNode };

const sectionIcons = { issues: AlertCircle, branches: GitBranch, actions: Workflow, settings: Settings };

export function canManageRepository(organization: OrganizationSummary) {
  return organization.role === "owner" || organization.role === "admin";
}

export function RepositoryMasthead({ organization, repository, actions }: Props) {
  const { t } = useTranslation("repositories");
  const handle = organizationHandle(organization);
  const [owner, name] = repository.split("/");
  return <header className="repo-masthead">
    <div className="repo-browser-heading">
      <div>
        <Link className="repo-back" to={orgPath(handle, "repositories")}>{t("repositories:browser.backToRepositories")}</Link>
        <h1 aria-label={repository}><span><span className="repo-owner">{owner} / </span>{name}</span></h1>
      </div>
      {actions}
    </div>
    <nav className="repo-section-nav" aria-label={t("repositories:browser.sections")}>
      <NavLink to={repositoryPath(handle, repository)} end><Code2 size={16} aria-hidden="true"/>{t("repositories:browser.code")}</NavLink>
      {repositorySections.filter(section => section !== "settings" || canManageRepository(organization)).map(section => {
        const Icon = sectionIcons[section];
        return <NavLink key={section} to={repositoryPath(handle, repository, section)} end={section !== "issues"}>
          <Icon size={16} aria-hidden="true"/>{t(`repositories:sections.${section}`)}
        </NavLink>;
      })}
    </nav>
  </header>;
}
