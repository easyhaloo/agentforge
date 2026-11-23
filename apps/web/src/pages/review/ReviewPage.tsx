import { useCallback, useEffect, useState } from "react";
import { GitPullRequest, CheckCircle2 } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { changesetAPI, changesetStatuses, repositoryAPI, type OrganizationSummary, type RepositoryMetadata, type StoredChangeset } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { changesetPath, organizationHandle } from "../../shared/routing";
import { SearchInput, Select } from "../../shared/ui";
import { ChangesetTable, changesetRows } from "../changesets/ui/ChangesetTable";
import { CHANGESET_QUERY_MAX, readChangesetFilters, writeChangesetFilters, type ChangesetFilters } from "../changesets/changeset-filters";

type Props = { organization: OrganizationSummary; onNotify: (message: string) => void };

/** Review workspace: shows changesets assigned to the current user for review. */
export function ReviewPage({ organization, onNotify }: Props) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { org } = useParams();
  const handle = org || organizationHandle(organization);
  const filters = readChangesetFilters(searchParams);
  const [queryDraft, setQueryDraft] = useState(filters.q);
  const [items, setItems] = useState<StoredChangeset[]>([]);
  const [total, setTotal] = useState(0);
  const [repositories, setRepositories] = useState<RepositoryMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const rows = changesetRows(items);
  const page = Math.floor(filters.offset / filters.limit) + 1;

  // Review page defaults to showing reviews assigned to "me"
  const effectiveFilters = { ...filters, reviewer: filters.reviewer || "me" };

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [page, repoPage] = await Promise.all([
        changesetAPI.list(organization.id, {
          q: effectiveFilters.q,
          repository: effectiveFilters.repository,
          status: effectiveFilters.status || undefined,
          reviewer: effectiveFilters.reviewer,
          limit: effectiveFilters.limit,
          offset: effectiveFilters.offset,
        }),
        repositoryAPI.list(organization.id),
      ]);
      setItems(page.items); setTotal(page.total); setRepositories(repoPage.items);
    } catch (cause) { setError(translateError(cause, t, "changesets:errors.listFailed")); }
    finally { setLoading(false); }
  }, [organization.id, effectiveFilters.q, effectiveFilters.repository, effectiveFilters.status, effectiveFilters.reviewer, effectiveFilters.limit, effectiveFilters.offset, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setQueryDraft(filters.q); }, [filters.q]);

  const applyFilters = (patch: Partial<ChangesetFilters>) => setSearchParams(writeChangesetFilters(patch, searchParams));

  const pendingReviewsCount = items.filter(item => item.status === "in_review").length;
  const changesRequestedCount = items.filter(item => item.status === "changes_requested").length;

  return <section className="changesets-page">
    <div className="changesets-summary card">
      <div className="changesets-summary__icon"><GitPullRequest size={20}/></div>
      <div>
        <b>{t("review:page.summary", { count: total })}</b>
        <p>{t("review:page.description")}</p>
      </div>
      <span className="org-role">{organization.role}</span>
    </div>
    {error && <div className="org-error" role="alert">{error}</div>}

    <div className="changesets-list card">
      <div className="changesets-list__head">
        <div>
          <h3>{t("review:list.title")}</h3>
          <p>{t("review:list.description", { organizationName: organization.name })}</p>
        </div>
        <div className="changesets-filters">
          <SearchInput
            value={queryDraft}
            onChange={setQueryDraft}
            onSearch={value => applyFilters({ q: value.slice(0, CHANGESET_QUERY_MAX) })}
            placeholder={t("changesets:list.searchPlaceholder")}
            className="changesets-search"
          />
          <Select
            aria-label={t("changesets:list.filterByStatus")}
            placeholder={t("changesets:list.allStatuses")}
            value={filters.status}
            onChange={event => applyFilters({ status: event.target.value as ChangesetFilters["status"] })}
            options={changesetStatuses.filter(s => ["in_review", "changes_requested", "review_required"].includes(s)).map(status => ({
              value: status,
              label: t(`changesets:status.${status}`)
            }))}
          />
          <Select
            aria-label={t("changesets:list.filterByRepository")}
            placeholder={t("changesets:list.allRepositories")}
            value={filters.repository}
            onChange={event => applyFilters({ repository: event.target.value })}
            options={repositories.map(item => ({ value: item.slug, label: item.slug }))}
          />
        </div>
      </div>

      <div className="review-stats">
        <div className="review-stat">
          <CheckCircle2 size={16} />
          <span>{t("review:stats.pendingReviews", { count: pendingReviewsCount })}</span>
        </div>
        <div className="review-stat">
          <GitPullRequest size={16} />
          <span>{t("review:stats.changesRequested", { count: changesRequestedCount })}</span>
        </div>
      </div>

      {loading ? <div className="org-loading">{t("changesets:page.loadingMessage")}</div> : <ChangesetTable
        items={items}
        total={total}
        page={page}
        pageSize={filters.limit}
        emptyText={filters.q || filters.repository || filters.status ? t("review:list.emptyFiltered") : t("review:list.emptyDefault")}
        pathFor={id => changesetPath(handle, id)}
        onPageChange={(nextPage, pageSize) => applyFilters({ limit: pageSize, offset: (nextPage - 1) * pageSize })}
        onOpen={id => navigate(changesetPath(handle, id))}
      />}
      <div className="changesets-list__foot">
        <span>{t("changesets:list.footer", { count: rows.length, total })}</span>
      </div>
    </div>
  </section>;
}
