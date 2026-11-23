import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, XCircle } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { changesetAPI, repositoryAPI, type OrganizationSummary, type RepositoryMetadata, type StoredChangeset } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { changesetPath, organizationHandle } from "../../shared/routing";
import { SearchInput, Select } from "../../shared/ui";
import { ChangesetTable, changesetRows } from "../changesets/ui/ChangesetTable";
import { CHANGESET_QUERY_MAX, readChangesetFilters, writeChangesetFilters, type ChangesetFilters } from "../changesets/changeset-filters";

type Props = { organization: OrganizationSummary; onNotify: (message: string) => void };

/** Eval workspace: shows changesets in evaluation-related states. */
export function EvalPage({ organization, onNotify }: Props) {
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

  // Eval page defaults to showing evaluation-related statuses
  const evalStatuses = ["evaluation_pending", "evaluation_failed", "evidence_required"] as const;
  const effectiveStatus = filters.status && evalStatuses.includes(filters.status as any)
    ? filters.status
    : undefined;

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [page, repoPage] = await Promise.all([
        changesetAPI.list(organization.id, {
          q: filters.q,
          repository: filters.repository,
          status: effectiveStatus,
          limit: filters.limit,
          offset: filters.offset,
        }),
        repositoryAPI.list(organization.id),
      ]);
      setItems(page.items); setTotal(page.total); setRepositories(repoPage.items);
    } catch (cause) { setError(translateError(cause, t, "changesets:errors.listFailed")); }
    finally { setLoading(false); }
  }, [organization.id, filters.q, filters.repository, effectiveStatus, filters.limit, filters.offset, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setQueryDraft(filters.q); }, [filters.q]);

  const applyFilters = (patch: Partial<ChangesetFilters>) => setSearchParams(writeChangesetFilters(patch, searchParams));

  const pendingCount = items.filter(item => item.status === "evaluation_pending").length;
  const failedCount = items.filter(item => item.status === "evaluation_failed").length;
  const evidenceRequiredCount = items.filter(item => item.status === "evidence_required").length;

  return <section className="changesets-page">
    <div className="changesets-summary card">
      <div className="changesets-summary__icon"><CheckCircle2 size={20}/></div>
      <div>
        <b>{t("eval:page.summary", { count: total })}</b>
        <p>{t("eval:page.description")}</p>
      </div>
      <span className="org-role">{organization.role}</span>
    </div>
    {error && <div className="org-error" role="alert">{error}</div>}

    <div className="changesets-list card">
      <div className="changesets-list__head">
        <div>
          <h3>{t("eval:list.title")}</h3>
          <p>{t("eval:list.description", { organizationName: organization.name })}</p>
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
            aria-label={t("eval:list.filterByStatus")}
            placeholder={t("eval:list.allEvalStatuses")}
            value={filters.status}
            onChange={event => applyFilters({ status: event.target.value as ChangesetFilters["status"] })}
            options={evalStatuses.map(status => ({
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

      <div className="eval-stats">
        <div className="eval-stat">
          <AlertCircle size={16} />
          <span>{t("eval:stats.pending", { count: pendingCount })}</span>
        </div>
        <div className="eval-stat">
          <XCircle size={16} />
          <span>{t("eval:stats.failed", { count: failedCount })}</span>
        </div>
        <div className="eval-stat">
          <CheckCircle2 size={16} />
          <span>{t("eval:stats.evidenceRequired", { count: evidenceRequiredCount })}</span>
        </div>
      </div>

      {loading ? <div className="org-loading">{t("changesets:page.loadingMessage")}</div> : <ChangesetTable
        items={items}
        total={total}
        page={page}
        pageSize={filters.limit}
        emptyText={filters.q || filters.repository || filters.status ? t("eval:list.emptyFiltered") : t("eval:list.emptyDefault")}
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
