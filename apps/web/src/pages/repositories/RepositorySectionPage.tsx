import type { OrganizationSummary } from "../../shared/api/identity";
import { organizationHandle } from "../../shared/routing";
import { RepositoryActions } from "./RepositoryActions";
import { RepositoryIssues } from "./RepositoryIssues";
import "./repositories.css";

type Props = { organization: OrganizationSummary; repository: string; section: "issues" | "actions"; currentUser: string };

export function RepositorySectionPage({ organization, repository, section, currentUser }: Props) {
  return <section className="repo-layout repo-browser">
    {section === "issues" ? (
      <RepositoryIssues organization={organization} repository={repository} organizationHandle={organizationHandle(organization)} currentUser={currentUser} />
    ) : (
      <RepositoryActions key={`${organization.id}/${repository}`} organization={organization} repository={repository} />
    )}
  </section>;
}
