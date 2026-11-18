import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus, RefreshCw, GitCommitHorizontal, GitBranch, AlertTriangle } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { changesetAPI, changesetStatuses, repositoryAPI, type OrganizationSummary, type RepositoryMetadata, type StoredChangeset } from "../../shared/api/identity";
import { changesetPath, organizationHandle } from "../../shared/routing";
import { Button, Input, SearchInput, Select } from "../../shared/ui";
import { ChangesetTable, changesetRows } from "./ui/ChangesetTable";
import { changesetStatusLabels } from "./changeset-status";
import { CHANGESET_QUERY_MAX, readChangesetFilters, writeChangesetFilters, type ChangesetFilters } from "./changeset-filters";

type Props = { organization: OrganizationSummary; onNotify: (message: string) => void };

/** The changeset list: a collection view whose filters live in the URL, so a list is linkable. */
export function ChangesetsPage({ organization, onNotify }: Props) {
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load delivery data"); }
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
      onNotify("Changeset created and persisted.");
      // A new changeset belongs to an unfiltered list, so the list starts again and shows it.
      if (filters.q || filters.repository || filters.status || filters.reviewer || filters.offset) {
        setSearchParams(writeChangesetFilters({ offset: 0 }, new URLSearchParams()), { replace: true });
      }
      setReloadToken(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Changeset creation failed"); }
    finally { setBusy(false); }
  };
  return <section className="changesets-page">
    <div className="changesets-summary card">
      <div className="changesets-summary__icon"><GitCommitHorizontal size={20}/></div>
      <div><b>{total} persisted changesets</b><p>Organization-scoped Git lifecycle · PostgreSQL state</p></div>
      <span className="org-role">{organization.role}</span>
      <Button className="button secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={14}/> Refresh</Button>
    </div>
    {error && <div className="org-error" role="alert">{error}</div>}
    {repositories.length > 0 && <form className="changeset-create card" onSubmit={create}>
      <div className="changeset-create__heading"><div><h3>Create changeset</h3><p>Starts a persisted delivery workflow against a registered repository</p></div><span className="changeset-create__secure">Server validated</span></div>
      <div className="changeset-create__fields">
        <Select label="Repository" required value={repository} onChange={event => setRepository(event.target.value)} options={repositories.map(item => ({ value: item.slug, label: `${item.slug} · ${item.default_branch}` }))}/>
        <Input label="Title" required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="Describe the change"/>
        <Button className="button primary" type="submit" disabled={busy || !repository}><Plus size={14}/> Create</Button>
      </div>
    </form>}
    {!repositories.length && !loading && <div className="org-admin-empty card"><GitBranch size={22}/><h2>No repositories registered</h2><p>Register a repository on the organization's repositories page before creating a changeset.</p></div>}
    <div className="changesets-list card">
      <div className="changesets-list__head">
        <div><h3>Changesets</h3><p>Newest records first · scoped to {organization.name}</p></div>
        <div className="changesets-filters">
          <SearchInput value={queryDraft} onChange={setQueryDraft} onSearch={value => applyFilters({ q: value.slice(0, CHANGESET_QUERY_MAX) })} placeholder="Search ID, title or repository" className="changesets-search"/>
          <Select aria-label="Filter by status" placeholder="All statuses" value={filters.status} onChange={event => applyFilters({ status: event.target.value as ChangesetFilters["status"] })} options={changesetStatuses.map(status => ({ value: status, label: changesetStatusLabels[status] }))}/>
          <Select aria-label="Filter by repository" placeholder="All repositories" value={filters.repository} onChange={event => applyFilters({ repository: event.target.value })} options={repositories.map(item => ({ value: item.slug, label: item.slug }))}/>
          <Button className="button secondary" aria-pressed={filters.reviewer === "me" && filters.status === "in_review"} onClick={() => applyFilters({ reviewer: "me", status: "in_review" })}>My pending reviews</Button>
        </div>
      </div>
      {loading ? <div className="org-loading">Loading changesets…</div> : <ChangesetTable
        items={items}
        total={total}
        page={page}
        pageSize={filters.limit}
        emptyText={filters.q || filters.repository || filters.status || filters.reviewer ? "No changesets match the filters." : "No changesets yet."}
        pathFor={id => changesetPath(handle, id)}
        onPageChange={(nextPage, pageSize) => applyFilters({ limit: pageSize, offset: (nextPage - 1) * pageSize })}
        onOpen={id => navigate(changesetPath(handle, id))}
      />}
      <div className="changesets-list__foot"><span>{rows.length} of {total} changesets</span><span><AlertTriangle size={12}/> Data from organization API</span></div>
    </div>
  </section>;
}
