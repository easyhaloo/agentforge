import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus, RefreshCw, Search, GitCommitHorizontal, ArrowUpRight } from "lucide-react";
import { changesetAPI, type StoredChangeset } from "../../shared/api/identity";
import type { OrganizationSummary } from "../../shared/api/identity";

type Props = { organization: OrganizationSummary; onNotify: (message: string) => void };
const dateTime = (value: string) => new Date(value).toLocaleString();
function statusOf(item: StoredChangeset["changeset"]): string {
  if (item.merge) return "Merged";
  const latest = item.evaluations[item.evaluations.length - 1];
  if (latest?.status === "failed") return "Evaluation failed";
  if (latest?.status === "passed") return "Ready for review";
  return item.revisions.length ? "In progress" : "Draft";
}
function statusClass(status: string) {
  if (status === "Merged" || status === "Ready for review") return "status success";
  if (status === "Evaluation failed") return "status danger";
  return "status muted";
}

export function ChangesetsPage({ organization, onNotify }: Props) {
  const [items, setItems] = useState<StoredChangeset[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [repository, setRepository] = useState("");
  const [title, setTitle] = useState("");
  const [search, setSearch] = useState("");
  const canCreate = organization.role !== "viewer";

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const page = await changesetAPI.list(organization.id);
      setItems(page.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load changesets");
    } finally { setLoading(false); }
  }, [organization.id]);
  useEffect(() => { void load(); }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true); setError("");
    try {
      const created = await changesetAPI.create(organization.id, repository.trim(), title.trim());
      setItems((current) => [created, ...current]);
      setRepository(""); setTitle("");
      onNotify(`Changeset ${created.changeset.id} created.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create changeset");
    } finally { setCreating(false); }
  };

  const filtered = items.filter(({ changeset }) => {
    const needle = search.trim().toLowerCase();
    return !needle || [changeset.id, changeset.title, changeset.repository, changeset.created_by].some((value) => value.toLowerCase().includes(needle));
  });

  return <section className="changesets-page">
    <div className="changesets-summary card">
      <div className="changesets-summary__icon"><GitCommitHorizontal size={20}/></div>
      <div><b>{items.length} persisted changesets</b><p>Stored by the selected organization in PostgreSQL</p></div>
      <span className="org-role">{organization.role}</span>
      <button className="button secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={14}/> Refresh</button>
    </div>
    {error && <div className="org-error" role="alert">{error}</div>}
    {canCreate && <form className="changeset-create card" onSubmit={create}>
      <div className="changeset-create__heading"><div><h3>Create changeset</h3><p>Persist a new organization-scoped changeset record.</p></div><span className="changeset-create__secure">Backend validated</span></div>
      <div className="changeset-create__fields">
        <label>Repository<input required maxLength={200} value={repository} onChange={event=>setRepository(event.target.value)} placeholder="owner/repository"/></label>
        <label>Title<input required maxLength={200} value={title} onChange={event=>setTitle(event.target.value)} placeholder="Describe the change"/></label>
        <button className="button primary" type="submit" disabled={creating}><Plus size={14}/>{creating?"Creating…":"Create changeset"}</button>
      </div>
    </form>}
    <div className="changesets-list card">
      <div className="changesets-list__head"><div><h3>Changesets</h3><p>Newest records first · scoped to {organization.name}</p></div><label className="changesets-search"><Search size={14}/><input aria-label="Search changesets" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search ID, title or repository"/></label></div>
      {loading ? <div className="org-loading">Loading changesets…</div> : <div className="org-table-wrap changesets-table-wrap"><table className="org-table changesets-table"><thead><tr><th>CHANGESET</th><th>REPOSITORY</th><th>STATUS</th><th>REVISION</th><th>UPDATED</th><th>VERSION</th></tr></thead><tbody>
        {filtered.map((item) => {
          const change = item.changeset; const status = statusOf(change);
          return <tr key={change.id}><td><b>{change.title}</b><small className="mono">{change.id}</small></td><td>{change.repository}</td><td><span className={statusClass(status)}>{status}</span></td><td>{change.revisions.length ? change.revisions[change.revisions.length-1].ref : "—"}</td><td>{dateTime(item.updated_at)}</td><td><span className="mono">v{item.version}</span></td></tr>;
        })}
        {!filtered.length && <tr><td colSpan={6} className="org-empty">{items.length ? "No changesets match this search." : "No persisted changesets yet. Create one above to get started."}</td></tr>}
      </tbody></table></div>}
      <div className="changesets-list__foot"><span>{filtered.length} of {items.length} changesets</span><span><ArrowUpRight size={12}/> Data from organization API</span></div>
    </div>
  </section>;
}
