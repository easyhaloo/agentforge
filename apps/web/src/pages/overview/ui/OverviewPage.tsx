import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, BookMarked, GitPullRequest, Workflow } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { changesetAPI, repositoryAPI, type ChangesetPage, type OrganizationSummary, type RepositoryMetadata, type StoredChangeset } from "../../../shared/api/identity";
import { pipelines, type Summary } from "../../../shared/api/pipelines";
import { changesetPath, orgPath, organizationHandle, pipelineEditPath } from "../../../shared/routing";
import { Alert, Button, Empty, Loading } from "../../../shared/ui";
import "./overview.css";

type Props = { organization: OrganizationSummary; userId: string; displayName: string };

export function OverviewPage({ organization, userId, displayName }: Props) {
  const { t } = useTranslation("overview");
  const [repositories, setRepositories] = useState<RepositoryMetadata[]>();
  const [reviews, setReviews] = useState<ChangesetPage>();
  const [changes, setChanges] = useState<StoredChangeset[]>();
  const [definitions, setDefinitions] = useState<Summary[]>();
  const [errors, setErrors] = useState<string[]>([]);
  const [params, setParams] = useSearchParams();
  const mine = params.get("view") === "mine";
  const orgId = organization.id;

  useEffect(() => {
    let active = true;
    const load = <T,>(section: string, request: Promise<T>, set: (result: T) => void) => {
      void request.then(result => { if (active) set(result); }).catch(() => {
        if (active) setErrors(previous => [...previous, section]);
      });
    };
    load("repositories", repositoryAPI.list(orgId), result => setRepositories(result.items ?? []));
    load("reviews", changesetAPI.list(orgId, { reviewer: "me", status: "in_review", limit: 5 }), setReviews);
    // ponytail: My recent changes filters the 20 newest records; add an author API filter for full history.
    load("changes", changesetAPI.list(orgId), result => setChanges(result.items ?? []));
    load("pipelines", pipelines.list(orgId), result => setDefinitions(result.items ?? []));
    return () => { active = false; };
  }, [orgId]);

  const handle = organizationHandle(organization);
  const changesetsUrl = orgPath(handle, "changesets");
  const reviewUrl = `${changesetsUrl}?reviewer=me&status=in_review`;
  const repositoriesUrl = orgPath(handle, "repositories");
  const pipelinesUrl = orgPath(handle, "pipelines");
  const authored = changes?.filter(item => item.changeset.created_by === userId).slice(0, 5);
  const sectionContent = (section: string, count: number | undefined, empty: string, content: ReactNode) => {
    if (errors.includes(section)) return <div className="workbench-message"><Alert status="error">{t("workbench.loadError")}</Alert></div>;
    if (count === undefined) return <div className="workbench-message"><Loading /></div>;
    if (!count) return <div className="workbench-message">{empty}</div>;
    return content;
  };
  const rows = (items: StoredChangeset[] | undefined, review = false) => <ul className="workbench-list">
    {items?.map(({ changeset, status }) => <li key={changeset.id}>
      <Link to={changesetPath(handle, changeset.id, review ? "review" : "overview")}>
        <GitPullRequest size={17} aria-hidden="true" />
        <span><strong>{changeset.title}</strong><small>{changeset.id} · {changeset.repository} · {t("workbench.revisions", { count: changeset.revisions?.length ?? 0 })}</small></span>
        {!review && <small className="workbench-status">{t(`changesets:status.${status}`)}</small>}
        <ArrowRight size={14} className="workbench-row-arrow" aria-hidden="true" />
      </Link>
    </li>)}
  </ul>;

  return <div className="workbench">
    <aside className="workbench-repositories">
      <Link className="workbench-quick" to={reviewUrl}><GitPullRequest size={16} />{t("workbench.pending")}{reviews && <span>{reviews.total}</span>}</Link>
      <section className="workbench-repo-list" aria-label={t("workbench.repositories")}>
        <h2>{t("workbench.repositories")}</h2>
        {sectionContent("repositories", repositories?.length, t("repositories:empty"), <ul className="workbench-list">
          {repositories?.slice(0, 6).map(repository => <li key={repository.slug}>
            <Link to={`${repositoriesUrl}?${new URLSearchParams({ repository: repository.slug })}`}><BookMarked size={15} /><strong>{repository.slug}</strong></Link>
          </li>)}
        </ul>)}
        <Link className="workbench-link" to={repositoriesUrl}>{t("workbench.allRepositories")} <ArrowRight size={13} /></Link>
      </section>
    </aside>
    <div className="workbench-center">
      <header className="page-heading workbench-heading">
        <div><h1>{t("navigation:routes.overview")}</h1><p>{t("workbench.welcome", { name: displayName })}</p></div>
        <Link className="button primary" to={reviewUrl}>{t("workbench.openReviews")} <ArrowRight size={15} /></Link>
      </header>
      <section className="workbench-card" aria-label={t("workbench.attention")}>
        <header><h2>{t("workbench.attention")}</h2></header>
        <div className="workbench-tabs" role="group" aria-label={t("workbench.attention")}>
          <Button variant="ghost" aria-pressed={!mine} onClick={() => setParams({})}>{t("workbench.pending")} {reviews && <span>{reviews.total}</span>}</Button>
          <Button variant="ghost" aria-pressed={mine} onClick={() => setParams({ view: "mine" })}>{t("workbench.mine")}</Button>
        </div>
        {mine
          ? sectionContent("changes", authored?.length, t("workbench.noMine"), rows(authored))
          : sectionContent("reviews", reviews?.items?.length, t("workbench.noReviews"), rows(reviews?.items, true))}
      </section>
      <section className="workbench-card" aria-label={t("workbench.recent")}>
        <header><h2>{t("workbench.recent")}</h2><Link className="workbench-link" to={changesetsUrl}>{t("workbench.allChanges")} <ArrowRight size={13} /></Link></header>
        {sectionContent("changes", changes?.length, t("changesets:list.emptyDefault"), rows(changes?.slice(0, 5)))}
      </section>
    </div>
    <section className="workbench-card workbench-pipelines" aria-label={t("workbench.pipelines")}>
      <header><h2>{t("workbench.pipelines")}</h2><Link className="workbench-link" to={pipelinesUrl}>{t("workbench.allPipelines")} <ArrowRight size={13} /></Link></header>
      {sectionContent("pipelines", definitions?.length, t("pipelines:empty"), <ul className="workbench-list">
        {definitions?.slice(0, 5).map(pipeline => <li key={pipeline.id}>
          <Link to={pipelineEditPath(handle, pipeline.id)}>
            <Workflow size={16} /><strong>{pipeline.name}</strong>
            <small className={`workbench-status workbench-status--${pipeline.status}`}>{t(`pipelines:${pipeline.status}`)}</small>
          </Link>
        </li>)}
      </ul>)}
    </section>
  </div>;
}

export function OverviewUnavailable({ title, children }: { title: string; children?: ReactNode }) {
  const { t } = useTranslation();
  return <div className="workbench-unavailable">
    <div className="page-heading"><h1>{t("navigation:routes.overview")}</h1></div>
    <Empty title={title} action={children} />
  </div>;
}
