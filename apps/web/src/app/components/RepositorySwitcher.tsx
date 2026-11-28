import { useEffect, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { translateError } from "../../shared/api/errors";
import { repositoryAPI, type RepositoryMetadata } from "../../shared/api/identity";
import { ownerDisplayLabel, repositoryPath, type RepositorySection } from "../../shared/routing";
import { Input, Popover } from "../../shared/ui";
import { TopbarIcon } from "./TopbarIcon";

type Props = { organizationId: string; organizationName: string; handle: string; owner: string; repo: string; section?: RepositorySection };

export function RepositorySwitcher({ owner, repo, organizationName, ...context }: Props) {
  const { t } = useTranslation("navigation");
  const slug = `${owner}/${repo}`;
  const title = t("topbar.switchRepository");
  const ownerLabel = ownerDisplayLabel(owner, { id: context.organizationId, name: organizationName });
  return (
    <div className="topbar-repository">
      <span className="topbar-repository__owner" title={ownerLabel}>{ownerLabel}</span>
      <span aria-hidden="true">/</span>
      <Link className="topbar-repository__name" to={repositoryPath(context.handle, slug)} title={repo}>{repo}</Link>
      <Popover ariaLabel={title} trigger={<><ChevronDown size={14} aria-hidden="true" /><span className="topbar-repository__label">{title}</span></>}>
        <strong>{title}</strong>
        <RepositoryChoices {...context} slug={slug} owner={owner} />
      </Popover>
    </div>
  );
}

function RepositoryChoices({ organizationId, handle, slug, owner, section }: Omit<Props, "repo" | "organizationName"> & { slug: string }) {
  const { t } = useTranslation("navigation");
  const [query, setQuery] = useState("");
  const [repositories, setRepositories] = useState<RepositoryMetadata[]>();
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    let active = true;
    void repositoryAPI.list(organizationId).then(({ items }) => {
      if (active) setRepositories(items ?? []);
    }, cause => {
      if (active) setError(cause);
    });
    return () => { active = false; };
  }, [organizationId]);

  const search = t("topbar.searchRepositories");
  const matches = repositories?.filter(repository => repository.slug.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <Input aria-label={search} placeholder={search} value={query} onChange={event => setQuery(event.target.value)} />
    {error ? <div role="alert">{translateError(error, t, "repositories:feedback.loadFailed")}</div>
      : !matches ? <div role="status">{t("common:components.loading")}</div>
      : !matches.length ? <div role="status">{t("topbar.noMatchingRepositories")}</div>
      : <ul className="topbar-repository__list">
        {matches.map(({ slug: repository, visibility, fork }) => {
          const name = repository.startsWith(`${owner}/`) ? repository.slice(owner.length + 1) : repository;
          const type = fork ? "fork" : visibility;
          const icon = type === "fork" ? "repo-forked" : type === "private" ? "repo-locked" : "repo";
          const content = <><TopbarIcon name={icon} label={type && t(`repositories:types.${type}`)} /><span>{name}</span></>;
          return <li key={repository}>
            {repository === slug
              ? <span className="topbar-repository__row" aria-current="true">{content}<Check size={16} aria-hidden="true" className="topbar-repository__check" /></span>
              : <Link className="topbar-repository__row af-action-row" to={repositoryPath(handle, repository, section)}>{content}</Link>}
          </li>;
        })}
      </ul>}
  </>;
}
