import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus, RefreshCw, GitCommitHorizontal, GitBranch, AlertTriangle } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { changesetAPI, changesetStatuses, repositoryAPI, type OrganizationSummary, type RepositoryMetadata, type StoredChangeset } from "../../shared/api/identity";
import { changesetPath, organizationHandle } from "../../shared/routing";
import { Button, Input, SearchInput, Select } from "../../shared/ui";
import { ChangesetTable, changesetRows } from "./ui/ChangesetTable";
import { CHANGESET_QUERY_MAX, readChangesetFilters, writeChangesetFilters, type ChangesetFilters } from "./changeset-filters";

type Props = { organization: OrganizationSummary; onNotify: (message: string) => void };

/** The changeset list: a collection view whose filters live in the URL, so a list is linkable. */
export function ChangesetsPage({ organization, onNotify }: Props) {
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [repository, setRepository] = useState("");
  const [title, setTitle] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const rows = changesetRows(items);
  const page = Math.floor(filters.offset / filters.limit) + 1;

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [page, repoPage] = await Promise.all([
        changesetAPI.list(organization.id, {
          q: filters.q, repository: filters.repository, status: filters.status || undefined, reviewer: filters.reviewer,
          limit: filters.limit, offset: filters.offset,
        }),
        repositoryAPI.list(organization.id),
      ]);
      setItems(page.items); setTotal(page.total); setRepositories(repoPage.items);
      setRepository(current => current || repoPage.items[0]?.slug || "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("changesets:errors.loadFailed")); }
    finally { setLoading(false); }
  }, [organization.id, filters.q, filters.repository, filters.status, filters.reviewer, filters.limit, filters.offset, reloadToken]);
  useEffect(() => { void load(); }, [load]);
  // The URL owns the search term; the field is the edit buffer of the term the URL carries.
  useEffect(() => { setQueryDraft(filters.q); }, [filters.q]);

  /** Every filter change is a URL change, so the list stays linkable and survives a reload. */
  const applyFilters = (patch: Partial<ChangesetFilters>) => setSearchParams(writeChangesetFilters(patch, searchParams));

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await changesetAPI.create(organization.id, repository, title.trim());
      setTitle("");
      onNotify(t("changesets:create.successMessage"));
      // A new changeset belongs to an unfiltered list, so the list starts again and shows it.
      if (filters.q || filters.repository || filters.status || filters.reviewer || filters.offset) {
        setSearchParams(writeChangesetFilters({ offset: 0 }, new URLSearchParams()), { replace: true });
      }
      setReloadToken(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("changesets:create.errorMessage")); }
    finally { setBusy(false); }
  };
  return <section className="changesets-page">
    <div className="changesets-summary card">
      <div className="changesets-summary__icon"><GitCommitHorizontal size={20}/></div>
      <div><b>{t("changesets:page.summary", { count: total })}</b><p>{t("changesets:page.description")}</p></div>
      <span className="org-role">{organization.role}</span>
      <Button className="button secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={14}/> {t("common:actions.refresh")}</Button>
    </div>
    {error && <div className="org-error" role="alert">{error}</div>}
    {repositories.length > 0 && <form className="changeset-create card" onSubmit={create}>
      <div className="changeset-create__heading"><div><h3>{t("changesets:create.title")}</h3><p>{t("changesets:create.description")}</p></div><span className="changeset-create__secure">{t("changesets:create.validated")}</span></div>
      <div className="changeset-create__fields">
        <Select label={t("changesets:create.repositoryLabel")} required value={repository} onChange={event => setRepository(event.target.value)} options={repositories.map(item => ({ value: item.slug, label: `${item.slug} · ${item.default_branch}` }))}/>
        <Input label={t("changesets:create.titleLabel")} required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder={t("changesets:create.titlePlaceholder")}/>
        <Button className="button primary" type="submit" disabled={busy || !repository}><Plus size={14}/> {t("changesets:create.createButton")}</Button>
      </div>
    </form>}
    {!repositories.length && !loading && <div className="org-admin-empty card"><GitBranch size={22}/><h2>{t("changesets:empty.noRepositories")}</h2><p>{t("changesets:empty.noRepositoriesDescription")}</p></div>}
    <div className="changesets-list card">
      <div className="changesets-list__head">
        <div><h3>{t("changesets:list.title")}</h3><p>{t("changesets:list.description", { organizationName: organization.name })}</p></div>
        <div className="changesets-filters">
          <SearchInput value={queryDraft} onChange={setQueryDraft} onSearch={value => applyFilters({ q: value.slice(0, CHANGESET_QUERY_MAX) })} placeholder={t("changesets:list.searchPlaceholder")} className="changesets-search"/>
          <Select aria-label={t("changesets:list.filterByStatus")} placeholder={t("changesets:list.allStatuses")} value={filters.status} onChange={event => applyFilters({ status: event.target.value as ChangesetFilters["status"] })} options={changesetStatuses.map(status => ({ value: status, label: t(`changesets:status.${status}`) }))}/>
          <Select aria-label={t("changesets:list.filterByRepository")} placeholder={t("changesets:list.allRepositories")} value={filters.repository} onChange={event => applyFilters({ repository: event.target.value })} options={repositories.map(item => ({ value: item.slug, label: item.slug }))}/>
          <Button className="button secondary" aria-pressed={filters.reviewer === "me" && filters.status === "in_review"} onClick={() => applyFilters({ reviewer: "me", status: "in_review" })}>{t("changesets:list.myPendingReviews")}</Button>
        </div>
      </div>
      {loading ? <div className="org-loading">{t("changesets:page.loadingMessage")}</div> : <ChangesetTable
        items={items}
        total={total}
        page={page}
        pageSize={filters.limit}
        emptyText={filters.q || filters.repository || filters.status || filters.reviewer ? t("changesets:list.emptyFiltered") : t("changesets:list.emptyDefault")}
        pathFor={id => changesetPath(handle, id)}
        onPageChange={(nextPage, pageSize) => applyFilters({ limit: pageSize, offset: (nextPage - 1) * pageSize })}
        onOpen={id => navigate(changesetPath(handle, id))}
      />}
      <div className="changesets-list__foot"><span>{t("changesets:list.footer", { count: rows.length, total })}</span><span><AlertTriangle size={12}/> {t("changesets:list.dataSource")}</span></div>
    </div>
  </section>;
}
