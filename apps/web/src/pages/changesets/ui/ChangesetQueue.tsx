import { useEffect, useId, useState } from "react";
import { ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Clock3, GitPullRequest } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { changesetAPI, repositoryAPI, type ChangesetPage, type ChangesetStatus, type OrganizationSummary, type RepositoryMetadata } from "../../../shared/api/identity";
import { translateError } from "../../../shared/api/errors";
import { useDateFormatting } from "../../../shared/i18n/format";
import { changesetPath, organizationHandle } from "../../../shared/routing";
import { Button, Empty, SearchInput, Select } from "../../../shared/ui";
import { CHANGESET_QUERY_MAX, readChangesetFilters, writeChangesetFilters } from "../changeset-filters";
import { changesetStatusLabel } from "../changeset-status";
import "./coordination.css";

const reviewStatuses: readonly ChangesetStatus[] = ["in_review", "changes_requested"];
const evalStatuses: readonly ChangesetStatus[] = ["evaluation_pending", "evaluation_failed", "evidence_required"];

export function ChangesetQueue({ organization, kind }: { organization: OrganizationSummary; kind: "review" | "eval" }) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormatting();
  const heading = useId();
  const { org = organizationHandle(organization) } = useParams();
  const [params, setParams] = useSearchParams();
  const { q, repository, status, reviewer, limit, offset } = readChangesetFilters(params);
  const isReview = kind === "review";
  const evaluationStatus = status && evalStatuses.includes(status) ? status : "evaluation_pending";
  const selected = isReview ? status : evaluationStatus;
  const assignedReviewer = isReview ? reviewer || "me" : undefined;
  const [query, setQuery] = useState(q);
  const [result, setResult] = useState<ChangesetPage>();
  const [repositories, setRepositories] = useState<RepositoryMetadata[]>([]);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => setQuery(q), [q]);
  useEffect(() => {
    let active = true;
    setError("");
    setResult(undefined);
    void Promise.all([
      changesetAPI.list(organization.id, { q, repository, status: selected || undefined, reviewer: assignedReviewer, limit, offset }),
      repositoryAPI.list(organization.id),
    ]).then(([page, repos]) => {
      if (!active) return;
      setRepositories(repos.items);
      setResult(page);
    }).catch((cause: unknown) => {
      if (active) setError(translateError(cause, t, "changesets:errors.listFailed"));
    });
    return () => { active = false; };
  }, [organization.id, q, repository, selected, assignedReviewer, limit, offset, retry, t]);

  const pageLink = (nextOffset: number) => ({ search: writeChangesetFilters({ status: selected, offset: nextOffset }, params).toString() });
  const filters: readonly (ChangesetStatus | "")[] = isReview ? ["", ...reviewStatuses] : evalStatuses;

  return <section className="coordination" aria-labelledby={heading}>
    <div className="coordination-toolbar">
      <SearchInput value={query} onChange={setQuery}
        onSearch={value => setParams(writeChangesetFilters({ q: value.slice(0, CHANGESET_QUERY_MAX) }, params))}
        placeholder={t("changesets:list.searchPlaceholder")} />
      <Select aria-label={t("changesets:list.filterByRepository")} placeholder={t("changesets:list.allRepositories")}
        value={repository} onChange={event => setParams(writeChangesetFilters({ repository: event.target.value }, params))}
        options={repositories.map(repo => ({ value: repo.slug, label: repo.slug }))} />
    </div>
    <div className="coordination-panel">
      <div className="coordination-list-header">
        <h1 id={heading}>{t(`${kind}:list.title`)}</h1>
        {result && <span className="coordination-meta">{t("common:components.itemCount", { count: result.total })}</span>}
      </div>
      <nav className="coordination-filters" aria-label={t("changesets:list.filterByStatus")}>
        {filters.map(filter => <Link key={filter} aria-current={selected === filter ? "true" : undefined}
          to={{ search: writeChangesetFilters({ status: filter }, params).toString() }}>
          {filter ? changesetStatusLabel(filter, t) : t("review:list.allAssigned")}
        </Link>)}
      </nav>
      {error ? <div className="coordination-feedback"><p role="alert">{error}</p><Button onClick={() => setRetry(value => value + 1)}>{t("common:actions.retry")}</Button></div>
        : !result ? <p className="coordination-feedback" role="status">{t(`${kind}:page.loadingMessage`)}</p>
        : result.items.length === 0 ? <Empty title={t(q || repository || (isReview && status) ? `${kind}:list.emptyFiltered` : `${kind}:list.emptyDefault`)} />
        : <ul className="coordination-list" aria-labelledby={heading}>
          {result.items.map(({ changeset, status: lifecycle, updated_at }) => {
            const revision = changeset.revisions.at(-1);
            const evaluation = revision && changeset.evaluations.filter(item => item.revision_id === revision.id).at(-1);
            const needsAttention = lifecycle === "evaluation_failed" || lifecycle === "changes_requested";
            const Icon = isReview ? GitPullRequest : needsAttention ? CircleAlert : lifecycle === "evidence_required" ? CircleCheck : Clock3;
            return <li className="coordination-row" key={changeset.id}>
              <Icon size={18} className={needsAttention ? "coordination-danger" : lifecycle === "evidence_required" ? "coordination-success" : "coordination-meta"} aria-hidden="true" />
              <div className="coordination-row-text">
                <Link to={changesetPath(org, changeset.id, isReview ? "review" : "evaluation")}>{changeset.title || changeset.id}</Link>
                <div className="coordination-meta">
                  {[changeset.id, changeset.repository, revision?.commit_sha.slice(0, 12), formatDateTime(updated_at)].filter(Boolean).join(" · ")}
                </div>
                {!isReview && evaluation?.summary && <div className="coordination-meta">{evaluation.summary}</div>}
              </div>
              <span className={`coordination-status${needsAttention ? " coordination-danger" : ""}`}>{changesetStatusLabel(lifecycle, t)}</span>
            </li>;
          })}
        </ul>}
      {result && (offset > 0 || offset + limit < result.total) && <nav className="coordination-pagination" aria-label={t("common:pagination.page")}>
        {offset > 0 && <Link to={pageLink(Math.max(0, offset - limit))}><ChevronLeft size={16} aria-hidden="true" />{t("common:actions.previous")}</Link>}
        {offset + limit < result.total && <Link to={pageLink(offset + limit)}>{t("common:actions.next")}<ChevronRight size={16} aria-hidden="true" /></Link>}
      </nav>}
    </div>
  </section>;
}
